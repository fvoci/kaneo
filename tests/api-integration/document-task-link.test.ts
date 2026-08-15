import { eq } from "drizzle-orm";
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

function listDocumentTasks(app: App, documentId: string) {
  return app.request(`/api/document/${documentId}/tasks`);
}

function linkTask(app: App, documentId: string, taskId: string) {
  return app.request(`/api/document/${documentId}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId }),
  });
}

function unlinkTask(app: App, documentId: string, taskId: string) {
  return app.request(`/api/document/${documentId}/tasks/${taskId}`, {
    method: "DELETE",
  });
}

function listTaskDocuments(app: App, taskId: string) {
  return app.request(`/api/document/task/${taskId}`);
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

  describe("backlinks", () => {
    it("lists the documents that reference a task", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const first = await (
        await createDocument(app, project.id, { title: "프로토콜" })
      ).json();
      await linkTask(app, first.id, task.id);
      await createDocument(app, project.id, {
        title: "링크 없는 문서",
        content: `본문에 ${task.id} 를 적어도 참조는 아니다`,
      });

      const response = await listTaskDocuments(app, task.id);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(first.id);
      expect(body[0].title).toBe("프로토콜");
    });

    it("returns an empty list for a task nothing references", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect(await (await listTaskDocuments(app, task.id)).json()).toEqual([]);
    });

    it("drops a document from the list once the link is removed", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (await createDocument(app, project.id)).json();
      await linkTask(app, created.id, task.id);
      expect(await (await listTaskDocuments(app, task.id)).json()).toHaveLength(
        1,
      );

      await unlinkTask(app, created.id, task.id);

      expect(await (await listTaskDocuments(app, task.id)).json()).toEqual([]);
    });

    it("hides archived documents from the list", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (await createDocument(app, project.id)).json();
      await linkTask(app, created.id, task.id);

      await app.request(`/api/document/${created.id}`, { method: "DELETE" });

      expect(await (await listTaskDocuments(app, task.id)).json()).toEqual([]);
    });

    it("blocks reading the backlinks of another workspace's task", async () => {
      const victim = await createWorkspaceMember({ role: "admin" });
      const attacker = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });
      const task = await seedTask(project.id, 1);

      mockAuthenticatedSession(victim.user);
      const victimApp = createApp().app;
      const created = await (
        await createDocument(victimApp, project.id, { title: "기밀 문서" })
      ).json();
      expect((await linkTask(victimApp, created.id, task.id)).status).toBe(200);

      mockAuthenticatedSession(attacker.user);
      const { app } = createApp();
      const response = await listTaskDocuments(app, task.id);

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("기밀 문서");
    });

    it("returns 404 for a task that does not exist", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      await createProjectFixture({ workspaceId: member.workspace.id });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect((await listTaskDocuments(app, "missing-task")).status).toBe(404);
    });

    it("allows a viewer to read backlinks", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect((await listTaskDocuments(app, task.id)).status).toBe(200);
    });
  });

  describe("explicit links", () => {
    it("links a task to a document and lists it", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1, "설계 검토");
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, { content: "본문만" })
      ).json();
      expect(await linkedTaskIds(created.id)).toEqual([]);

      const response = await linkTask(app, created.id, task.id);
      expect(response.status).toBe(200);
      expect(await linkedTaskIds(created.id)).toEqual([task.id]);

      const listed = await (await listDocumentTasks(app, created.id)).json();
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe(task.id);
      expect(listed[0].title).toBe("설계 검토");
    });

    it("shows the document in the task's backlinks", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, { title: "프로토콜" })
      ).json();
      await linkTask(app, created.id, task.id);

      const backlinks = await (await listTaskDocuments(app, task.id)).json();
      expect(backlinks).toHaveLength(1);
      expect(backlinks[0].title).toBe("프로토콜");
    });

    it("removes a link by its two sides", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (await createDocument(app, project.id)).json();
      await linkTask(app, created.id, task.id);
      expect(await linkedTaskIds(created.id)).toEqual([task.id]);

      const response = await unlinkTask(app, created.id, task.id);
      expect(response.status).toBe(200);
      expect(await linkedTaskIds(created.id)).toEqual([]);
    });

    it("rejects linking the same task twice", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (await createDocument(app, project.id)).json();
      expect((await linkTask(app, created.id, task.id)).status).toBe(200);
      expect((await linkTask(app, created.id, task.id)).status).toBe(409);
      expect(await linkedTaskIds(created.id)).toEqual([task.id]);
    });

    it("returns 404 when unlinking something that is not linked", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (await createDocument(app, project.id)).json();
      expect((await unlinkTask(app, created.id, task.id)).status).toBe(404);
    });

    it("links a task from another project in the same workspace", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const home = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const other = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(other.project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (await createDocument(app, home.project.id)).json();

      expect((await linkTask(app, created.id, task.id)).status).toBe(200);
      expect(await linkedTaskIds(created.id)).toEqual([task.id]);
    });
  });

  describe("explicit links are still validated", () => {
    it("refuses a task from another workspace", async () => {
      // "Explicit" describes the user's intent, not the request's
      // trustworthiness: any id can be posted.
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
      const created = await (
        await createDocument(app, attackerProject.project.id)
      ).json();

      const response = await linkTask(app, created.id, victimTask.id);

      expect(response.status).toBe(404);
      expect(await linkedTaskIds(created.id)).toEqual([]);

      const rows = await db
        .select({ id: schema.documentTaskLinkTable.id })
        .from(schema.documentTaskLinkTable)
        .where(eq(schema.documentTaskLinkTable.taskId, victimTask.id));
      expect(rows).toEqual([]);
    });

    it("refuses a task that does not exist", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (await createDocument(app, project.id)).json();
      expect((await linkTask(app, created.id, "missing-task")).status).toBe(
        404,
      );
    });

    it("blocks linking on another workspace's document", async () => {
      const victim = await createWorkspaceMember({ role: "admin" });
      const attacker = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });
      const task = await seedTask(project.id, 1);

      mockAuthenticatedSession(victim.user);
      const created = await (
        await createDocument(createApp().app, project.id)
      ).json();

      mockAuthenticatedSession(attacker.user);
      const { app } = createApp();
      expect((await linkTask(app, created.id, task.id)).status).toBe(403);
      expect((await listDocumentTasks(app, created.id)).status).toBe(403);
    });

    it("blocks a viewer from linking (viewer lacks task:update)", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      const [document] = await db
        .insert(schema.documentTable)
        .values({ projectId: project.id, title: "읽기 전용" })
        .returning();
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect((await linkTask(app, document.id, task.id)).status).toBe(403);
      // Reading the references is still allowed.
      expect((await listDocumentTasks(app, document.id)).status).toBe(200);
    });

    it("drops links when the document's project is deleted", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (await createDocument(app, project.id)).json();
      await linkTask(app, created.id, task.id);
      expect(await linkedTaskIds(created.id)).toEqual([task.id]);

      await db
        .delete(schema.projectTable)
        .where(eq(schema.projectTable.id, project.id));

      expect(await linkedTaskIds(created.id)).toEqual([]);
    });

    it("drops the link when the linked task is deleted", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (await createDocument(app, project.id)).json();
      await linkTask(app, created.id, task.id);

      await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));

      expect(await linkedTaskIds(created.id)).toEqual([]);
    });
  });

  describe("the body does not create references", () => {
    it("stores an issue link in the body without linking the task", async () => {
      // Inline chips navigate to a task; they do not relate a document to one.
      // The server used to parse the body and store a row for every chip it
      // found, which made a reference something you could create by accident.
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const chip = `<kaneo-issue-link url="https://kaneo.test/t/${task.id}" issue-key="KAN-1" task-id="${task.id}" />`;

      const created = await (
        await createDocument(app, project.id, { content: `본문 ${chip}` })
      ).json();
      expect(await linkedTaskIds(created.id)).toEqual([]);

      const updated = await app.request(`/api/document/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Doc",
          content: `수정한 본문 ${chip}`,
          version: created.version,
        }),
      });
      expect(updated.status).toBe(200);

      expect(await linkedTaskIds(created.id)).toEqual([]);
      expect(await (await listTaskDocuments(app, task.id)).json()).toEqual([]);
      expect(await (await listDocumentTasks(app, created.id)).json()).toEqual(
        [],
      );
    });

    it("keeps an explicit link when the body stops mentioning the task", async () => {
      // The mirror image: the body no longer removes references either.
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (await createDocument(app, project.id)).json();
      await linkTask(app, created.id, task.id);

      const updated = await app.request(`/api/document/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Doc",
          content: "태스크 얘기가 전혀 없는 본문",
          version: created.version,
        }),
      });
      expect(updated.status).toBe(200);

      expect(await linkedTaskIds(created.id)).toEqual([task.id]);
    });
  });

  describe("route shapes do not collide", () => {
    it("keeps /:id, /task/:taskId and /:id/tasks apart", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await (
        await createDocument(app, project.id, { title: "라우트 확인" })
      ).json();
      await linkTask(app, created.id, task.id);

      // A document by id.
      const single = await app.request(`/api/document/${created.id}`);
      expect(single.status).toBe(200);
      expect((await single.json()).title).toBe("라우트 확인");

      // Backlinks: "task" here is a literal segment, not a document id.
      const backlinks = await listTaskDocuments(app, task.id);
      expect(backlinks.status).toBe(200);
      expect((await backlinks.json())[0].id).toBe(created.id);

      // A document's references.
      const tasks = await listDocumentTasks(app, created.id);
      expect(tasks.status).toBe(200);
      expect((await tasks.json())[0].id).toBe(task.id);
    });

    it('does not read a document called "task" out of the backlink route', async () => {
      const member = await createWorkspaceMember({ role: "member" });
      await createProjectFixture({ workspaceId: member.workspace.id });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      // Would be a document id of "task" if the literal segment lost.
      const response = await app.request("/api/document/task/missing-task");
      expect(response.status).toBe(404);
    });
  });
});
