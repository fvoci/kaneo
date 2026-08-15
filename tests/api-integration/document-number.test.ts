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

function createDocument(app: App, projectId: string, title = "Doc") {
  return app.request(`/api/document/project/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

async function counterFor(projectId: string) {
  const [project] = await db
    .select({ last: schema.projectTable.lastDocumentNumber })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, projectId));
  return project?.last;
}

describe("API integration: document numbers", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("numbers documents from one upwards within a project", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const first = await (await createDocument(app, project.id, "첫째")).json();
    const second = await (await createDocument(app, project.id, "둘째")).json();
    const third = await (await createDocument(app, project.id, "셋째")).json();

    expect([first.number, second.number, third.number]).toEqual([1, 2, 3]);
    expect(await counterFor(project.id)).toBe(3);
  });

  it("counts separately in each project", async () => {
    // Numbers are shown next to the project slug, so they only have to be
    // unique within one project.
    const member = await createWorkspaceMember({ role: "member" });
    const { project: first } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const { project: second } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    await createDocument(app, first.id);
    await createDocument(app, first.id);
    const other = await (await createDocument(app, second.id)).json();

    expect(other.number).toBe(1);
    expect(await counterFor(first.id)).toBe(2);
    expect(await counterFor(second.id)).toBe(1);
  });

  it("does not reuse the number of a deleted document", async () => {
    // A reference to an archived document has to keep pointing at that
    // document, so its number stays spent.
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const first = await (await createDocument(app, project.id)).json();
    const second = await (await createDocument(app, project.id)).json();
    expect([first.number, second.number]).toEqual([1, 2]);

    await app.request(`/api/document/${second.id}`, { method: "DELETE" });

    const third = await (await createDocument(app, project.id)).json();
    expect(third.number).toBe(3);

    // The archived document keeps the number it was given.
    const [archived] = await db
      .select({ number: schema.documentTable.number })
      .from(schema.documentTable)
      .where(eq(schema.documentTable.id, second.id));
    expect(archived?.number).toBe(2);
  });

  it("hands out distinct numbers when documents are created at once", async () => {
    // The claim advances the counter in the same statement that reads it. Were
    // it a read followed by a write, two of these would collide and the unique
    // constraint would reject one.
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        createDocument(app, project.id, `동시 ${index}`),
      ),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);

    const numbers = (
      await Promise.all(responses.map((response) => response.json()))
    ).map((document) => document.number);

    expect(new Set(numbers).size).toBe(10);
    expect([...numbers].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(await counterFor(project.id)).toBe(10);
  });

  it("exposes the number on reads and on backlinks", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Task",
        status: "to-do",
        number: 1,
        position: 1,
      })
      .returning();
    if (!task) throw new Error("Failed to seed task");
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const created = await (await createDocument(app, project.id)).json();
    await app.request(`/api/document/${created.id}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });

    const single = await (
      await app.request(`/api/document/${created.id}`)
    ).json();
    expect(single.number).toBe(1);

    const list = await (
      await app.request(`/api/document/project/${project.id}`)
    ).json();
    expect(list[0].number).toBe(1);

    // The backlink carries the slug too, because the document it names may
    // belong to a different project than the task.
    const backlinks = await (
      await app.request(`/api/document/task/${task.id}`)
    ).json();
    expect(backlinks[0].number).toBe(1);
    expect(backlinks[0].projectSlug).toBe(project.slug);
  });
});
