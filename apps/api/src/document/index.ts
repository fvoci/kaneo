import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver, validator } from "hono-openapi";
import { requireDocumentAccess } from "../utils/require-document-access";
import createDocument from "./controllers/create-document";
import deleteDocument from "./controllers/delete-document";
import getDocument from "./controllers/get-document";
import getDocumentTasks from "./controllers/get-document-tasks";
import getDocuments from "./controllers/get-documents";
import getTaskDocuments from "./controllers/get-task-documents";
import linkDocumentTask from "./controllers/link-document-task";
import unlinkDocumentTask from "./controllers/unlink-document-task";
import updateDocument from "./controllers/update-document";
import {
  createDocumentSchema,
  documentBacklinkListSchema,
  documentIdParamSchema,
  documentListSchema,
  documentProjectIdParamSchema,
  documentSchema,
  documentTaskIdParamSchema,
  documentTaskLinkParamSchema,
  documentTaskLinkSchema,
  documentTaskListSchema,
  documentVersionConflictSchema,
  linkDocumentTaskSchema,
  updateDocumentSchema,
} from "./schemas";

function requireUserId(c: { get: (key: "userId") => string | undefined }) {
  const userId = c.get("userId");
  if (!userId) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return userId;
}

// `/project/:projectId` must be registered before `/:id`; Hono matches in
// registration order, so the reverse would swallow it as `id === "project"`.
const document = new Hono<{
  Variables: {
    userId: string;
    workspaceId: string;
  };
}>()
  .get(
    "/project/:projectId",
    describeRoute({
      operationId: "listDocuments",
      tags: ["Documents"],
      description: "List the non-archived documents in a project",
      responses: {
        200: {
          description: "Documents ordered by most recently updated",
          content: {
            "application/json": { schema: resolver(documentListSchema) },
          },
        },
      },
    }),
    validator("param", documentProjectIdParamSchema),
    requireDocumentAccess.fromProjectId("read"),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const documents = await getDocuments(projectId);
      return c.json(documents);
    },
  )
  .post(
    "/project/:projectId",
    describeRoute({
      operationId: "createDocument",
      tags: ["Documents"],
      description: "Create a document in a project",
      responses: {
        200: {
          description: "Document created successfully",
          content: {
            "application/json": { schema: resolver(documentSchema) },
          },
        },
      },
    }),
    validator("param", documentProjectIdParamSchema),
    validator("json", createDocumentSchema),
    requireDocumentAccess.fromProjectId("create"),
    async (c) => {
      const userId = requireUserId(c);
      const { projectId } = c.req.valid("param");
      const { title, content } = c.req.valid("json");
      const created = await createDocument({
        projectId,
        title,
        content,
        currentUserId: userId,
      });
      return c.json(created);
    },
  )
  // Registered before "/:id" so the literal segment wins; the reverse order
  // would swallow this as a document whose id is "task".
  .get(
    "/task/:taskId",
    describeRoute({
      operationId: "listTaskDocuments",
      tags: ["Documents"],
      description: "List the documents whose body references a task",
      responses: {
        200: {
          description: "Documents ordered by most recently updated",
          content: {
            "application/json": {
              schema: resolver(documentBacklinkListSchema),
            },
          },
        },
      },
    }),
    validator("param", documentTaskIdParamSchema),
    requireDocumentAccess.fromTaskId("read"),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const documents = await getTaskDocuments(taskId);
      return c.json(documents);
    },
  )
  .get(
    "/:id/tasks",
    describeRoute({
      operationId: "listDocumentTasks",
      tags: ["Documents"],
      description: "List the tasks a document references",
      responses: {
        200: {
          description: "Referenced tasks, most recently linked first",
          content: {
            "application/json": { schema: resolver(documentTaskListSchema) },
          },
        },
      },
    }),
    validator("param", documentIdParamSchema),
    requireDocumentAccess.fromDocumentId("read"),
    async (c) => {
      const { id } = c.req.valid("param");
      const tasks = await getDocumentTasks(id);
      return c.json(tasks);
    },
  )
  .post(
    "/:id/tasks",
    describeRoute({
      operationId: "linkDocumentTask",
      tags: ["Documents"],
      description: "Reference a task from a document",
      responses: {
        200: {
          description: "Link created",
          content: {
            "application/json": { schema: resolver(documentTaskLinkSchema) },
          },
        },
        409: { description: "The link already exists" },
      },
    }),
    validator("param", documentIdParamSchema),
    validator("json", linkDocumentTaskSchema),
    requireDocumentAccess.fromDocumentId("update"),
    async (c) => {
      const userId = requireUserId(c);
      const { id } = c.req.valid("param");
      const { taskId } = c.req.valid("json");
      const link = await linkDocumentTask({
        documentId: id,
        taskId,
        workspaceId: c.get("workspaceId"),
        currentUserId: userId,
      });
      return c.json(link);
    },
  )
  .delete(
    "/:id/tasks/:taskId",
    describeRoute({
      operationId: "unlinkDocumentTask",
      tags: ["Documents"],
      description: "Stop referencing a task from a document",
      responses: {
        200: {
          description: "Link removed",
          content: {
            "application/json": { schema: resolver(documentTaskLinkSchema) },
          },
        },
      },
    }),
    validator("param", documentTaskLinkParamSchema),
    requireDocumentAccess.fromDocumentId("update"),
    async (c) => {
      const userId = requireUserId(c);
      const { id, taskId } = c.req.valid("param");
      const removed = await unlinkDocumentTask({
        documentId: id,
        taskId,
        currentUserId: userId,
      });
      return c.json(removed);
    },
  )
  .get(
    "/:id",
    describeRoute({
      operationId: "getDocument",
      tags: ["Documents"],
      description: "Get a single document",
      responses: {
        200: {
          description: "Document found",
          content: {
            "application/json": { schema: resolver(documentSchema) },
          },
        },
      },
    }),
    validator("param", documentIdParamSchema),
    requireDocumentAccess.fromDocumentId("read"),
    async (c) => {
      const { id } = c.req.valid("param");
      const found = await getDocument(id);
      return c.json(found);
    },
  )
  .put(
    "/:id",
    describeRoute({
      operationId: "updateDocument",
      tags: ["Documents"],
      description:
        "Update a document. The request must carry the version the client last read; a mismatch is rejected with 409.",
      responses: {
        200: {
          description: "Document updated successfully",
          content: {
            "application/json": { schema: resolver(documentSchema) },
          },
        },
        409: {
          description: "The stored document has a newer version",
          content: {
            "application/json": {
              schema: resolver(documentVersionConflictSchema),
            },
          },
        },
      },
    }),
    validator("param", documentIdParamSchema),
    validator("json", updateDocumentSchema),
    requireDocumentAccess.fromDocumentId("update"),
    async (c) => {
      const userId = requireUserId(c);
      const { id } = c.req.valid("param");
      const { title, content, version } = c.req.valid("json");
      const updated = await updateDocument({
        id,
        title,
        content,
        version,
        currentUserId: userId,
      });
      return c.json(updated);
    },
  )
  .delete(
    "/:id",
    describeRoute({
      operationId: "deleteDocument",
      tags: ["Documents"],
      description: "Archive a document",
      responses: {
        200: {
          description: "Document archived successfully",
          content: {
            "application/json": { schema: resolver(documentSchema) },
          },
        },
      },
    }),
    validator("param", documentIdParamSchema),
    requireDocumentAccess.fromDocumentId("delete"),
    async (c) => {
      const userId = requireUserId(c);
      const { id } = c.req.valid("param");
      const archived = await deleteDocument({ id, currentUserId: userId });
      return c.json(archived);
    },
  );

export default document;
