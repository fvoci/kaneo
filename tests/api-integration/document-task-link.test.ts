import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];

function issueLink(taskId: string, url?: string) {
  return `<kaneo-issue-link url="${
    url ?? `https://kaneo.test/dashboard/workspace/w/project/p/task/${taskId}`
  }" issue-key="" task-id="${taskId}" />`;
}

function updateDocument(app: App, id: string, body: Record<string, unknown>) {
  return app.request(`/api/document/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Doc", ...body }),
  });
}

function createDocument(
  app: App,
  projectId: string,
  body: Record<string, unknown> = {},
) {
  return app.request(`/api/document/project/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Doc", ...body }),
  });
}

async function seedTask(projectId: string, number: number, title = "Task") {
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId, title, status: "to-do", number, position: number })
    .returning();
  if (!task) throw new Error("Failed to seed task");
  return task;
}

async function linkedTaskIds(documentId: string) {
  const rows = await db
    .select({ taskId: schema.documentTaskLinkTable.taskId })
    .from(schema.documentTaskLinkTable)
    .where(eq(schema.documentTaskLinkTable.documentId, documentId));
  return rows.map((row) => row.taskId).sort();
}

describe("API integration: document task links", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("sync on save", () => {
    it("creates a link for a task referenced in the body", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await createDocument(app, project.id, {
        content: `본문 ${issueLink(task.id)}`,
        taskIds: [task.id],
      });

      expect(response.status).toBe(200);
      const created = await response.json();
      expect(await linkedTaskIds(created.id)).toEqual([task.id]);
    });

    it("adds a link when one is added to the body", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const first = await seedTask(project.id, 1);
      const second = await seedTask(project.id, 2);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, {
          content: issueLink(first.id),
          taskIds: [first.id],
        })
      ).json();

      const response = await updateDocument(app, created.id, {
        content: `${issueLink(first.id)} ${issueLink(second.id)}`,
        version: created.version,
        taskIds: [first.id, second.id],
      });

      expect(response.status).toBe(200);
      expect(await linkedTaskIds(created.id)).toEqual(
        [first.id, second.id].sort(),
      );
    });

    it("removes a link when it disappears from the body", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const first = await seedTask(project.id, 1);
      const second = await seedTask(project.id, 2);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, {
          content: `${issueLink(first.id)} ${issueLink(second.id)}`,
          taskIds: [first.id, second.id],
        })
      ).json();
      expect(await linkedTaskIds(created.id)).toHaveLength(2);

      await updateDocument(app, created.id, {
        content: issueLink(second.id),
        version: created.version,
        taskIds: [second.id],
      });

      expect(await linkedTaskIds(created.id)).toEqual([second.id]);
    });

    it("clears every link when the body loses them all", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, {
          content: issueLink(task.id),
          taskIds: [task.id],
        })
      ).json();

      await updateDocument(app, created.id, {
        content: "링크 없는 본문",
        version: created.version,
        taskIds: [],
      });

      expect(await linkedTaskIds(created.id)).toEqual([]);
    });

    it("stores one link when the same task appears twice", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, {
          content: `${issueLink(task.id)} 그리고 ${issueLink(task.id)}`,
          taskIds: [task.id, task.id],
        })
      ).json();

      expect(await linkedTaskIds(created.id)).toEqual([task.id]);
    });

    it("recovers the task id from the url when the attribute is empty", async () => {
      // Bodies written before the editor round-tripped `task-id`.
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const legacy = `<kaneo-issue-link url="https://kaneo.test/dashboard/workspace/w/project/p/task/${task.id}" issue-key="" task-id="" />`;
      const created = await (
        await createDocument(app, project.id, { content: legacy })
      ).json();

      expect(await linkedTaskIds(created.id)).toEqual([task.id]);
    });
  });

  describe("server does not trust the client", () => {
    it("ignores a task id from another workspace", async () => {
      const attacker = await createWorkspaceMember({ role: "admin" });
      const victim = await createWorkspaceMember({ role: "admin" });
      const attackerProject = await createProjectFixture({
        workspaceId: attacker.workspace.id,
      });
      const victimProject = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });
      const victimTask = await seedTask(victimProject.project.id, 1, "Secret");

      mockAuthenticatedSession(attacker.user);
      const { app } = createApp();

      // The body references the foreign task and the client vouches for it.
      const response = await createDocument(app, attackerProject.project.id, {
        content: issueLink(victimTask.id),
        taskIds: [victimTask.id],
      });

      expect(response.status).toBe(200);
      const created = await response.json();
      expect(await linkedTaskIds(created.id)).toEqual([]);

      // Nothing was written that the victim's backlinks could surface.
      const rows = await db
        .select({ id: schema.documentTaskLinkTable.id })
        .from(schema.documentTaskLinkTable)
        .where(eq(schema.documentTaskLinkTable.taskId, victimTask.id));
      expect(rows).toEqual([]);
    });

    it("keeps same-workspace links while dropping foreign ones", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const foreign = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const foreignProject = await createProjectFixture({
        workspaceId: foreign.workspace.id,
      });
      const own = await seedTask(project.id, 1);
      const theirs = await seedTask(foreignProject.project.id, 1);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, {
          content: `${issueLink(own.id)} ${issueLink(theirs.id)}`,
          taskIds: [own.id, theirs.id],
        })
      ).json();

      expect(await linkedTaskIds(created.id)).toEqual([own.id]);
    });

    it("ignores a task id the body never mentions", async () => {
      // The intersection keeps "what is written" and "what is linked" in step.
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const mentioned = await seedTask(project.id, 1);
      const unmentioned = await seedTask(project.id, 2);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, {
          content: issueLink(mentioned.id),
          taskIds: [mentioned.id, unmentioned.id],
        })
      ).json();

      expect(await linkedTaskIds(created.id)).toEqual([mentioned.id]);
    });

    it("ignores a task id that does not exist", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, {
          content: issueLink("missing-task-id"),
          taskIds: ["missing-task-id"],
        })
      ).json();

      expect(await linkedTaskIds(created.id)).toEqual([]);
    });
  });

  describe("transaction", () => {
    it("rolls the links back when the version guard rejects the write", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const first = await seedTask(project.id, 1);
      const second = await seedTask(project.id, 2);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, {
          content: issueLink(first.id),
          taskIds: [first.id],
        })
      ).json();

      // Move the document on so the next write carries a stale version.
      await updateDocument(app, created.id, {
        content: issueLink(first.id),
        version: created.version,
        taskIds: [first.id],
      });

      const stale = await updateDocument(app, created.id, {
        content: issueLink(second.id),
        version: created.version,
        taskIds: [second.id],
      });

      expect(stale.status).toBe(409);
      // Neither the body nor its links moved.
      expect(await linkedTaskIds(created.id)).toEqual([first.id]);
      const [stored] = await db
        .select({ content: schema.documentTable.content })
        .from(schema.documentTable)
        .where(eq(schema.documentTable.id, created.id));
      expect(stored?.content).toContain(first.id);
      expect(stored?.content).not.toContain(second.id);
    });

    it("drops links when the document's project is deleted", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, {
          content: issueLink(task.id),
          taskIds: [task.id],
        })
      ).json();
      expect(await linkedTaskIds(created.id)).toEqual([task.id]);

      await db
        .delete(schema.projectTable)
        .where(eq(schema.projectTable.id, project.id));

      const rows = await db
        .select({ id: schema.documentTaskLinkTable.id })
        .from(schema.documentTaskLinkTable)
        .where(eq(schema.documentTaskLinkTable.documentId, created.id));
      expect(rows).toEqual([]);
    });

    it("drops the link when the linked task is deleted", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, {
          content: issueLink(task.id),
          taskIds: [task.id],
        })
      ).json();

      await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));

      expect(await linkedTaskIds(created.id)).toEqual([]);
      // The document itself survives losing a task it referenced.
      const [stored] = await db
        .select({ id: schema.documentTable.id })
        .from(schema.documentTable)
        .where(
          and(
            eq(schema.documentTable.id, created.id),
            eq(schema.documentTable.projectId, project.id),
          ),
        );
      expect(stored?.id).toBe(created.id);
    });
  });
});
