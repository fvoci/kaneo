import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock events to prevent side effects from ws/index.ts top-level subscriptions
vi.mock("../../../apps/api/src/events", () => ({
  subscribeToEvent: vi.fn(),
  publishEvent: vi.fn(),
}));

import {
  addConnection,
  broadcastToProject,
  initializeWebSocketAdapter,
  removeConnection,
  shutdownWebSocketAdapter,
} from "../../../apps/api/src/ws/index";

function makeFakeWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    raw: undefined,
    url: null,
    protocol: null,
  } as never;
}

function sentMessages(ws: ReturnType<typeof makeFakeWs>) {
  return (
    ws as unknown as { send: { mock: { calls: [string][] } } }
  ).send.mock.calls.map(([payload]) => JSON.parse(payload));
}

const FLUSH_MS = 150;

/**
 * Documents ride the existing per-project channel. These tests pin the two
 * properties that make that safe to ship into an existing deployment: document
 * messages reach their room, and nothing about the task messages that clients
 * already understand changes shape.
 */
describe("document broadcasts", () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await shutdownWebSocketAdapter();
  });

  it("delivers a document message carrying its document id", async () => {
    const ws = makeFakeWs();
    const connection = addConnection("project-1", ws, "user-1");

    broadcastToProject("project-1", {
      type: "DOCUMENT_UPDATED",
      projectId: "project-1",
      documentId: "doc-1",
    });
    await new Promise((resolve) => setTimeout(resolve, FLUSH_MS));

    expect(sentMessages(ws)).toEqual([
      { type: "DOCUMENT_UPDATED", projectId: "project-1", documentId: "doc-1" },
    ]);

    removeConnection("project-1", connection);
  });

  it("keeps two documents apart instead of collapsing them", async () => {
    // The batch window dedupes by message key. Without the document id in that
    // key, a second document changing within 100ms would silently replace the
    // first and one of the two rooms would never learn about it.
    const ws = makeFakeWs();
    const connection = addConnection("project-1", ws, "user-1");

    broadcastToProject("project-1", {
      type: "DOCUMENT_UPDATED",
      projectId: "project-1",
      documentId: "doc-1",
    });
    broadcastToProject("project-1", {
      type: "DOCUMENT_UPDATED",
      projectId: "project-1",
      documentId: "doc-2",
    });
    await new Promise((resolve) => setTimeout(resolve, FLUSH_MS));

    const documentIds = sentMessages(ws)
      .map((message) => message.documentId)
      .sort();
    expect(documentIds).toEqual(["doc-1", "doc-2"]);

    removeConnection("project-1", connection);
  });

  it("reaches a second project so cross-project backlinks refresh", async () => {
    // A document may reference a task in another project of the same
    // workspace; websockets are per project, so both rooms are told.
    const documentRoom = makeFakeWs();
    const taskRoom = makeFakeWs();
    const a = addConnection("project-doc", documentRoom, "user-1");
    const b = addConnection("project-task", taskRoom, "user-2");

    for (const room of ["project-doc", "project-task"]) {
      broadcastToProject(room, {
        type: "DOCUMENT_UPDATED",
        projectId: room,
        documentId: "doc-1",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, FLUSH_MS));

    expect(sentMessages(documentRoom)).toHaveLength(1);
    expect(sentMessages(taskRoom)).toHaveLength(1);
    expect(sentMessages(taskRoom)[0].documentId).toBe("doc-1");

    removeConnection("project-doc", a);
    removeConnection("project-task", b);
  });
});

describe("document broadcasts do not disturb task messages", () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await shutdownWebSocketAdapter();
  });

  it("sends task messages with no document field attached", async () => {
    // An older client reads these by their known keys; an unexpected field or a
    // missing one would change what it sees.
    const ws = makeFakeWs();
    const connection = addConnection("project-1", ws, "user-1");

    broadcastToProject("project-1", {
      type: "TASK_UPDATED",
      projectId: "project-1",
      taskId: "task-1",
    });
    await new Promise((resolve) => setTimeout(resolve, FLUSH_MS));

    expect(sentMessages(ws)).toEqual([
      { type: "TASK_UPDATED", projectId: "project-1", taskId: "task-1" },
    ]);

    removeConnection("project-1", connection);
  });

  it("still dedupes repeated task messages within a batch", async () => {
    const ws = makeFakeWs();
    const connection = addConnection("project-1", ws, "user-1");

    broadcastToProject("project-1", {
      type: "TASK_UPDATED",
      projectId: "project-1",
      taskId: "task-1",
    });
    broadcastToProject("project-1", {
      type: "TASK_UPDATED",
      projectId: "project-1",
      taskId: "task-1",
    });
    await new Promise((resolve) => setTimeout(resolve, FLUSH_MS));

    expect(sentMessages(ws)).toHaveLength(1);

    removeConnection("project-1", connection);
  });

  it("still keeps distinct tasks apart", async () => {
    const ws = makeFakeWs();
    const connection = addConnection("project-1", ws, "user-1");

    broadcastToProject("project-1", {
      type: "TASK_UPDATED",
      projectId: "project-1",
      taskId: "task-1",
    });
    broadcastToProject("project-1", {
      type: "TASK_UPDATED",
      projectId: "project-1",
      taskId: "task-2",
    });
    await new Promise((resolve) => setTimeout(resolve, FLUSH_MS));

    expect(
      sentMessages(ws)
        .map((message) => message.taskId)
        .sort(),
    ).toEqual(["task-1", "task-2"]);

    removeConnection("project-1", connection);
  });

  it("keeps a task relation message's own fields", async () => {
    const ws = makeFakeWs();
    const connection = addConnection("project-1", ws, "user-1");

    broadcastToProject("project-1", {
      type: "TASK_RELATION_UPDATED",
      projectId: "project-1",
      taskId: "task-1",
      sourceTaskId: "task-1",
      targetTaskId: "task-2",
    });
    await new Promise((resolve) => setTimeout(resolve, FLUSH_MS));

    expect(sentMessages(ws)).toEqual([
      {
        type: "TASK_RELATION_UPDATED",
        projectId: "project-1",
        taskId: "task-1",
        sourceTaskId: "task-1",
        targetTaskId: "task-2",
      },
    ]);

    removeConnection("project-1", connection);
  });
});
