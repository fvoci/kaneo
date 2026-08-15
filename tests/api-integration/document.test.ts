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

function listDocuments(app: App, projectId: string) {
  return app.request(`/api/document/project/${projectId}`);
}

function createDocument(
  app: App,
  projectId: string,
  body: Record<string, unknown> = {},
) {
  return app.request(`/api/document/project/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Protocol notes",
      content: "# Notes",
      ...body,
    }),
  });
}

function getDocument(app: App, id: string) {
  return app.request(`/api/document/${id}`);
}

function updateDocument(
  app: App,
  id: string,
  body: Record<string, unknown> = {},
) {
  return app.request(`/api/document/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Updated", version: 1, ...body }),
  });
}

function deleteDocument(app: App, id: string) {
  return app.request(`/api/document/${id}`, { method: "DELETE" });
}

async function seedDocument(projectId: string, overrides = {}) {
  const [document] = await db
    .insert(schema.documentTable)
    .values({
      projectId,
      title: "Seeded document",
      content: "seeded body",
      ...overrides,
    })
    .returning();
  if (!document) throw new Error("Failed to seed document");
  return document;
}

describe("API integration: documents", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("CRUD", () => {
    it("creates a document with version 1 and the caller as author", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await createDocument(app, project.id, {
        title: "Study protocol",
        content: "## Method",
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.title).toBe("Study protocol");
      expect(body.content).toBe("## Method");
      expect(body.version).toBe(1);
      expect(body.createdBy).toBe(member.user.id);
      expect(body.updatedBy).toBe(member.user.id);
      expect(body.parentId).toBeNull();
      expect(body.archivedAt).toBeNull();
    });

    it("lists only documents belonging to the requested project", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const a = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const b = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await seedDocument(a.project.id, { title: "In A" });
      await seedDocument(b.project.id, { title: "In B" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await listDocuments(app, a.project.id);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe("In A");
    });

    it("omits content from list rows", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await seedDocument(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const body = await (await listDocuments(app, project.id)).json();

      expect(body[0]).not.toHaveProperty("content");
      expect(body[0]).toHaveProperty("title");
    });

    it("reads a single document with its content", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await getDocument(app, document.id);

      expect(response.status).toBe(200);
      expect((await response.json()).content).toBe("seeded body");
    });

    it("returns 404 for a document that does not exist", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      await createProjectFixture({ workspaceId: member.workspace.id });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await getDocument(app, "missing-document-id");

      expect(response.status).toBe(404);
    });

    it("keeps the stored body when an update omits content", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await updateDocument(app, document.id, {
        title: "Renamed only",
        version: document.version,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.title).toBe("Renamed only");
      expect(body.content).toBe("seeded body");
    });

    it("rejects an empty title", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await createDocument(app, project.id, { title: "   " });

      expect(response.status).toBe(400);
    });
  });

  describe("optimistic concurrency", () => {
    it("increments the version and records the editor on success", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await updateDocument(app, document.id, {
        title: "Revised",
        content: "new body",
        version: document.version,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version).toBe(document.version + 1);
      expect(body.updatedBy).toBe(member.user.id);
    });

    it("rejects a stale version with 409 and reports the stored version", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const first = await updateDocument(app, document.id, {
        title: "First writer wins",
        version: document.version,
      });
      expect(first.status).toBe(200);

      // Second editor still holds the version it read before the first write.
      const stale = await updateDocument(app, document.id, {
        title: "Second writer loses",
        version: document.version,
      });

      expect(stale.status).toBe(409);
      const body = await stale.json();
      expect(body.currentVersion).toBe(document.version + 1);
      expect(body.message).toMatch(/modified/i);

      const [stored] = await db
        .select({ title: schema.documentTable.title })
        .from(schema.documentTable)
        .where(eq(schema.documentTable.id, document.id));
      expect(stored?.title).toBe("First writer wins");
    });

    it("lets exactly one of two concurrent updates win", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const [a, b] = await Promise.all([
        updateDocument(app, document.id, {
          title: "Racer A",
          version: document.version,
        }),
        updateDocument(app, document.id, {
          title: "Racer B",
          version: document.version,
        }),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);

      const [stored] = await db
        .select({ version: schema.documentTable.version })
        .from(schema.documentTable)
        .where(eq(schema.documentTable.id, document.id));
      expect(stored?.version).toBe(document.version + 1);
    });

    it("returns 404 rather than 409 when the document is gone", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      await createProjectFixture({ workspaceId: member.workspace.id });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await updateDocument(app, "missing-document-id", {
        version: 1,
      });

      expect(response.status).toBe(404);
    });
  });

  describe("archiving", () => {
    it("archives on delete instead of removing the row", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await deleteDocument(app, document.id);

      expect(response.status).toBe(200);
      const [stored] = await db
        .select({ archivedAt: schema.documentTable.archivedAt })
        .from(schema.documentTable)
        .where(eq(schema.documentTable.id, document.id));
      expect(stored?.archivedAt).toBeInstanceOf(Date);
    });

    it("hides archived documents from the list", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await seedDocument(project.id, { title: "Live" });
      await seedDocument(project.id, {
        title: "Archived",
        archivedAt: new Date(),
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const body = await (await listDocuments(app, project.id)).json();

      expect(body).toHaveLength(1);
      expect(body[0].title).toBe("Live");
    });

    it("returns 404 when reading an archived document", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id, {
        archivedAt: new Date(),
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect((await getDocument(app, document.id)).status).toBe(404);
    });

    it("refuses to update an archived document", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id, {
        archivedAt: new Date(),
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await updateDocument(app, document.id, {
        version: document.version,
      });

      expect(response.status).toBe(404);
    });

    it("refuses to archive an already archived document", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id, {
        archivedAt: new Date(),
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect((await deleteDocument(app, document.id)).status).toBe(404);
    });
  });

  describe("workspace boundaries", () => {
    it("blocks reading a document from another workspace by id", async () => {
      const victim = await createWorkspaceMember({ role: "admin" });
      const attacker = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });
      const document = await seedDocument(project.id, { title: "Private" });

      mockAuthenticatedSession(attacker.user);
      const { app } = createApp();

      const response = await getDocument(app, document.id);

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("Private");
    });

    it("blocks listing another workspace's project documents", async () => {
      const victim = await createWorkspaceMember({ role: "admin" });
      const attacker = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });
      await seedDocument(project.id);

      mockAuthenticatedSession(attacker.user);
      const { app } = createApp();

      expect((await listDocuments(app, project.id)).status).toBe(403);
    });

    it("blocks creating a document in another workspace's project", async () => {
      const victim = await createWorkspaceMember({ role: "admin" });
      const attacker = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });

      mockAuthenticatedSession(attacker.user);
      const { app } = createApp();

      expect((await createDocument(app, project.id)).status).toBe(403);
    });

    it("blocks updating another workspace's document", async () => {
      const victim = await createWorkspaceMember({ role: "admin" });
      const attacker = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });
      const document = await seedDocument(project.id);

      mockAuthenticatedSession(attacker.user);
      const { app } = createApp();

      const response = await updateDocument(app, document.id, {
        version: document.version,
      });

      expect(response.status).toBe(403);
    });

    it("blocks deleting another workspace's document", async () => {
      const victim = await createWorkspaceMember({ role: "admin" });
      const attacker = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });
      const document = await seedDocument(project.id);

      mockAuthenticatedSession(attacker.user);
      const { app } = createApp();

      expect((await deleteDocument(app, document.id)).status).toBe(403);
    });

    it("does not authorize a document through a conflicting workspaceId query", async () => {
      const attacker = await createWorkspaceMember({ role: "admin" });
      const victim = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });
      const document = await seedDocument(project.id);

      mockAuthenticatedSession(attacker.user);
      const { app } = createApp();

      // Passing a workspace the caller does belong to must not grant access to
      // a document that lives somewhere else.
      const response = await app.request(
        `/api/document/${document.id}?workspaceId=${attacker.workspace.id}`,
      );

      expect(response.status).toBe(403);
    });

    it("returns 403 when the user has no workspace_member row", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id);

      await db
        .delete(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.userId, member.user.id));

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect((await getDocument(app, document.id)).status).toBe(403);
    });

    it("rejects unauthenticated requests", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id);

      const { app } = createApp();

      expect([401, 403]).toContain(
        (await getDocument(app, document.id)).status,
      );
    });
  });

  describe("role permissions", () => {
    it("blocks a viewer from creating a document", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect((await createDocument(app, project.id)).status).toBe(403);
    });

    it("allows a viewer to read documents", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect((await getDocument(app, document.id)).status).toBe(200);
    });

    it("blocks a member from deleting a document (member lacks task:delete)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect((await deleteDocument(app, document.id)).status).toBe(403);
    });

    it("allows an admin to delete a document", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const document = await seedDocument(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect((await deleteDocument(app, document.id)).status).toBe(200);
    });
  });

  describe("project cascade", () => {
    it("drops documents when their project is deleted", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await seedDocument(project.id);

      await db
        .delete(schema.projectTable)
        .where(eq(schema.projectTable.id, project.id));

      const remaining = await db
        .select({ id: schema.documentTable.id })
        .from(schema.documentTable)
        .where(eq(schema.documentTable.projectId, project.id));

      expect(remaining).toHaveLength(0);
    });
  });
});
