import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import claimDocumentNumber from "../../apps/api/src/document/controllers/claim-document-number";
import { subscribeToEvent } from "../../apps/api/src/events";
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

function moveDocument(
  app: App,
  id: string,
  body: { parentId: string | null; position: number },
) {
  return app.request(`/api/document/${id}/move`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type DeletedEvent = { affectedProjectIds?: string[] };

const deletedEvents: DeletedEvent[] = [];
let deleteSubscriberReady = false;

/**
 * `subscribeToEvent` registers process-wide, so the subscription is made once
 * and the buffer cleared per capture rather than re-subscribing per test.
 */
function captureEvents(type: "document.deleted") {
  if (!deleteSubscriberReady) {
    deleteSubscriberReady = true;
    subscribeToEvent<DeletedEvent>(type, async (data) => {
      deletedEvents.push(data);
    });
  }
  deletedEvents.length = 0;
  return deletedEvents;
}

async function seedDocument(projectId: string, overrides = {}) {
  // Seeding skips the controller but still claims from the project's counter,
  // so a seeded document and one created through the API cannot collide.
  const [document] = await db
    .insert(schema.documentTable)
    .values({
      projectId,
      number: await claimDocumentNumber(projectId),
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

    it("ranks each new document after the ones already there", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      for (const title of ["First", "Second", "Third"]) {
        await createDocument(app, project.id, { title });
      }

      const body = await (await listDocuments(app, project.id)).json();
      expect(body.map((d: { title: string }) => d.title)).toEqual([
        "First",
        "Second",
        "Third",
      ]);
      // 0-based, matching what the reorder endpoint will renumber a sibling
      // group to.
      expect(body.map((d: { position: number }) => d.position)).toEqual([
        0, 1, 2,
      ]);
    });

    // The reason the list is ordered by position at all: it used to be ordered
    // by `updatedAt`, so saving a document threw it to the top and pushed every
    // other one down while the reader was looking at it.
    it("keeps a document in place when it is edited", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = [];
      for (const title of ["First", "Second", "Third"]) {
        created.push(
          await (await createDocument(app, project.id, { title })).json(),
        );
      }

      const first = created[0];
      const response = await updateDocument(app, first.id, {
        title: "First",
        content: "edited",
        version: first.version,
      });
      expect(response.status).toBe(200);

      const body = await (await listDocuments(app, project.id)).json();
      expect(body.map((d: { title: string }) => d.title)).toEqual([
        "First",
        "Second",
        "Third",
      ]);
    });

    // Archiving is reversible, so a rank handed out twice would tie the moment
    // the archived document came back.
    it("does not hand an archived document's rank to a new one", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const first = await (await createDocument(app, project.id)).json();
      const second = await (await createDocument(app, project.id)).json();
      expect(second.position).toBe(1);

      await deleteDocument(app, second.id);
      const third = await (await createDocument(app, project.id)).json();

      expect(third.position).toBe(2);
      expect(first.position).toBe(0);
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

    // Archiving only the document asked for would leave its children in the
    // list pointing at a parent that is no longer in it, and every surface that
    // reads the tree would need its own rule for orphans.
    it("archives the whole subtree, not just the document asked for", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const root = await seedDocument(project.id, { title: "Root" });
      const child = await seedDocument(project.id, {
        title: "Child",
        parentId: root.id,
      });
      const grandchild = await seedDocument(project.id, {
        title: "Grandchild",
        parentId: child.id,
      });
      const bystander = await seedDocument(project.id, { title: "Bystander" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect((await deleteDocument(app, root.id)).status).toBe(200);

      const rows = await db
        .select({
          id: schema.documentTable.id,
          archivedAt: schema.documentTable.archivedAt,
        })
        .from(schema.documentTable)
        .where(eq(schema.documentTable.projectId, project.id));
      const archivedAtById = new Map(
        rows.map((row) => [row.id, row.archivedAt]),
      );

      for (const descendant of [root, child, grandchild]) {
        expect(archivedAtById.get(descendant.id)).not.toBeNull();
      }
      expect(archivedAtById.get(bystander.id)).toBeNull();

      const listed = await (await listDocuments(app, project.id)).json();
      expect(listed.map((d: { title: string }) => d.title)).toEqual([
        "Bystander",
      ]);
    });

    // A restore will tell one archive operation from another by the timestamp
    // it wrote, so everything archived together has to carry the same one.
    //
    // What this actually guards is that the subtree is written by one UPDATE.
    // Hoisting the `new Date()` out of the `.set()` does not change anything on
    // its own — a single statement evaluates it once no matter where it is
    // written — so this test cannot fail from that. Rewriting the update as a
    // loop over the ids is what splits the timestamps, and that is the change
    // this catches.
    it("stamps the whole subtree with a single archivedAt", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const root = await seedDocument(project.id);
      const child = await seedDocument(project.id, { parentId: root.id });
      const grandchild = await seedDocument(project.id, { parentId: child.id });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      await deleteDocument(app, root.id);

      const rows = await db
        .select({ archivedAt: schema.documentTable.archivedAt })
        .from(schema.documentTable)
        .where(
          inArray(schema.documentTable.id, [root.id, child.id, grandchild.id]),
        );

      const stamps = new Set(
        rows.map((row) => row.archivedAt?.toISOString() ?? "null"),
      );
      expect(stamps.size).toBe(1);
      expect([...stamps][0]).not.toBe("null");
    });

    // The branch was archived by an earlier operation and carries that
    // operation's timestamp. Restamping it would fold it into this one, and a
    // restore of this document would drag it back up too.
    it("leaves a branch archived earlier at its own archivedAt", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const root = await seedDocument(project.id);
      const earlier = new Date("2020-01-01T00:00:00.000Z");
      const alreadyGone = await seedDocument(project.id, {
        parentId: root.id,
        archivedAt: earlier,
      });
      const stillHere = await seedDocument(project.id, { parentId: root.id });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      await deleteDocument(app, root.id);

      const [gone] = await db
        .select({ archivedAt: schema.documentTable.archivedAt })
        .from(schema.documentTable)
        .where(eq(schema.documentTable.id, alreadyGone.id));
      const [fresh] = await db
        .select({ archivedAt: schema.documentTable.archivedAt })
        .from(schema.documentTable)
        .where(eq(schema.documentTable.id, stillHere.id));

      expect(gone?.archivedAt?.toISOString()).toBe(earlier.toISOString());
      expect(fresh?.archivedAt?.toISOString()).not.toBe(earlier.toISOString());
    });

    // A descendant's backlink panel lives on its task's project channel, so a
    // cascade that only reports the target's own links leaves that panel
    // listing a document that has just gone.
    it("reports the projects of tasks the whole subtree referenced", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const other = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const [task] = await db
        .insert(schema.taskTable)
        .values({
          projectId: other.project.id,
          title: "Referenced by a descendant",
          status: "to-do",
          number: 1,
          position: 1,
        })
        .returning();
      if (!task) throw new Error("Failed to seed task");

      const root = await seedDocument(project.id);
      const child = await seedDocument(project.id, { parentId: root.id });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      await app.request(`/api/document/${child.id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });

      const events = captureEvents("document.deleted");
      await deleteDocument(app, root.id);

      expect(events).toHaveLength(1);
      expect(events[0]?.affectedProjectIds).toContain(other.project.id);
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

  describe("moving in the tree", () => {
    async function tree(projectId: string) {
      const root = await seedDocument(projectId, {
        title: "Root",
        position: 0,
      });
      const child = await seedDocument(projectId, {
        title: "Child",
        parentId: root.id,
        position: 0,
      });
      const grandchild = await seedDocument(projectId, {
        title: "Grandchild",
        parentId: child.id,
        position: 0,
      });
      return { root, child, grandchild };
    }

    const positionsUnder = async (projectId: string, parentId: string | null) =>
      db
        .select({
          id: schema.documentTable.id,
          position: schema.documentTable.position,
        })
        .from(schema.documentTable)
        .where(
          and(
            eq(schema.documentTable.projectId, projectId),
            parentId === null
              ? isNull(schema.documentTable.parentId)
              : eq(schema.documentTable.parentId, parentId),
            isNull(schema.documentTable.archivedAt),
          ),
        )
        .orderBy(asc(schema.documentTable.position));

    it("refuses to move a document inside its own descendant", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const { root, grandchild } = await tree(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await moveDocument(app, root.id, {
        parentId: grandchild.id,
        position: 0,
      });

      // The message matters as much as the status here. A move into your own
      // descendant is always too deep as well, so the depth check answers 409
      // too — asserting only the code would let the cycle check be deleted
      // without a single test noticing.
      expect(response.status).toBe(409);
      expect(await response.text()).toContain("inside itself");
    });

    it("refuses to move a document under itself", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const { root } = await tree(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await moveDocument(app, root.id, {
        parentId: root.id,
        position: 0,
      });

      expect(response.status).toBe(409);
      expect(await response.text()).toContain("inside itself");
    });

    it("refuses a parent from another project", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const a = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const b = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const mine = await seedDocument(a.project.id);
      const theirs = await seedDocument(b.project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await moveDocument(app, mine.id, {
        parentId: theirs.id,
        position: 0,
      });

      expect(response.status).toBe(400);
    });

    // Both sides of the cap. Writing the limit as `< MAX_DEPTH` instead of
    // `<= MAX_DEPTH` still rejects the fourth level, so only the first of these
    // catches it.
    it("allows a move that lands exactly at the depth limit", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const { child } = await tree(project.id);
      const loose = await seedDocument(project.id, { title: "Loose" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      // Loose has no children, so under Child it sits at level three.
      const response = await moveDocument(app, loose.id, {
        parentId: child.id,
        position: 0,
      });

      expect(response.status).toBe(200);
    });

    it("refuses a move that would land a fourth level deep", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const { grandchild } = await tree(project.id);
      const loose = await seedDocument(project.id, { title: "Loose" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await moveDocument(app, loose.id, {
        parentId: grandchild.id,
        position: 0,
      });

      expect(response.status).toBe(409);
      expect(await response.text()).toContain("levels deep");
    });

    // The document's own depth is fine; what busts the limit is the subtree it
    // brings with it.
    it("counts the subtree a move carries, not just the document", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const { child } = await tree(project.id);
      const branchRoot = await seedDocument(project.id, { title: "Branch" });
      await seedDocument(project.id, {
        title: "Branch leaf",
        parentId: branchRoot.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      // Branch alone would fit under Child at level three; its leaf would not.
      const response = await moveDocument(app, branchRoot.id, {
        parentId: child.id,
        position: 0,
      });

      expect(response.status).toBe(409);
      expect(await response.text()).toContain("levels deep");
    });

    // The invariant the cascade established: a parent nobody can see is a
    // parent nobody can move under.
    it("refuses to move under an archived parent", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const gone = await seedDocument(project.id, { archivedAt: new Date() });
      const mover = await seedDocument(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await moveDocument(app, mover.id, {
        parentId: gone.id,
        position: 0,
      });

      expect(response.status).toBe(404);
    });

    it("refuses to move an archived document", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const gone = await seedDocument(project.id, { archivedAt: new Date() });
      const parent = await seedDocument(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await moveDocument(app, gone.id, {
        parentId: parent.id,
        position: 0,
      });

      expect(response.status).toBe(404);
    });

    it("renumbers the group it left as well as the one it joined", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const parent = await seedDocument(project.id, { title: "Parent" });
      const a = await seedDocument(project.id, {
        title: "A",
        parentId: parent.id,
        position: 0,
      });
      const b = await seedDocument(project.id, {
        title: "B",
        parentId: parent.id,
        position: 1,
      });
      const c = await seedDocument(project.id, {
        title: "C",
        parentId: parent.id,
        position: 2,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      // A leaves the middle group entirely and lands at the front of the roots.
      expect(
        (await moveDocument(app, a.id, { parentId: null, position: 0 })).status,
      ).toBe(200);

      const left = await positionsUnder(project.id, parent.id);
      expect(left.map((row) => row.id)).toEqual([b.id, c.id]);
      expect(left.map((row) => row.position)).toEqual([0, 1]);

      const joined = await positionsUnder(project.id, null);
      expect(joined.map((row) => row.id)).toEqual([a.id, parent.id]);
      expect(joined.map((row) => row.position)).toEqual([0, 1]);
    });

    it("reorders within a group without changing the parent", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const first = await seedDocument(project.id, {
        title: "First",
        position: 0,
      });
      const second = await seedDocument(project.id, {
        title: "Second",
        position: 1,
      });
      const third = await seedDocument(project.id, {
        title: "Third",
        position: 2,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      await moveDocument(app, third.id, { parentId: null, position: 0 });

      const roots = await positionsUnder(project.id, null);
      expect(roots.map((row) => row.id)).toEqual([
        third.id,
        first.id,
        second.id,
      ]);
      expect(roots.map((row) => row.position)).toEqual([0, 1, 2]);
    });

    // Archived rows are not part of the ordering a reader manipulates, so a
    // move must not rewrite their rank.
    it("leaves an archived sibling's position alone", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const gone = await seedDocument(project.id, {
        position: 7,
        archivedAt: new Date(),
      });
      const a = await seedDocument(project.id, { position: 0 });
      const b = await seedDocument(project.id, { position: 1 });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      await moveDocument(app, b.id, { parentId: null, position: 0 });

      const [stored] = await db
        .select({ position: schema.documentTable.position })
        .from(schema.documentTable)
        .where(eq(schema.documentTable.id, gone.id));
      expect(stored?.position).toBe(7);

      const roots = await positionsUnder(project.id, null);
      expect(roots.map((row) => row.id)).toEqual([b.id, a.id]);
    });

    it("clamps a position past the end of the group", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const a = await seedDocument(project.id, { position: 0 });
      const b = await seedDocument(project.id, { position: 1 });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect(
        (await moveDocument(app, a.id, { parentId: null, position: 999 }))
          .status,
      ).toBe(200);

      const roots = await positionsUnder(project.id, null);
      expect(roots.map((row) => row.id)).toEqual([b.id, a.id]);
      expect(roots.map((row) => row.position)).toEqual([0, 1]);
    });

    // This does not prove the advisory lock: it passes with the lock removed
    // too, because the race is too narrow to hit from here. What it does hold
    // is the invariant the lock is there to protect — whatever order two
    // concurrent moves settle on, the group is still numbered 0..n-1 with no
    // duplicates. The lock itself rests on the same reasoning `createProject`
    // documents, and on `createDocument` already taking the same key.
    it("leaves the group numbered 0..n-1 after concurrent moves", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const a = await seedDocument(project.id, { position: 0 });
      const b = await seedDocument(project.id, { position: 1 });
      const c = await seedDocument(project.id, { position: 2 });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      await Promise.all([
        moveDocument(app, a.id, { parentId: null, position: 2 }),
        moveDocument(app, c.id, { parentId: null, position: 0 }),
      ]);

      // Whichever won, the group is still a clean 0..n-1 with no duplicates.
      const roots = await positionsUnder(project.id, null);
      expect(roots.map((row) => row.position)).toEqual([0, 1, 2]);
      expect(new Set(roots.map((row) => row.id)).size).toBe(3);
      expect(roots.map((row) => row.id)).toContain(b.id);
    });

    it("blocks a viewer from moving a document", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const { root, child } = await tree(project.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      expect(
        (await moveDocument(app, child.id, { parentId: null, position: 0 }))
          .status,
      ).toBe(403);
      expect(root).toBeTruthy();
    });

    it("blocks moving a document in another workspace", async () => {
      const victim = await createWorkspaceMember({ role: "admin" });
      const attacker = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });
      const document = await seedDocument(project.id);
      mockAuthenticatedSession(attacker.user);
      const { app } = createApp();

      expect(
        (await moveDocument(app, document.id, { parentId: null, position: 0 }))
          .status,
      ).toBe(403);
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
