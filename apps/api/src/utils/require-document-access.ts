import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { hasWorkspacePermission } from "./require-workspace-permission";
import { validateWorkspaceAccess } from "./validate-workspace-access";

export type DocumentAction = "read" | "create" | "update" | "delete";

/**
 * Documents borrow the task permission vocabulary so `@kaneo/permissions`
 * stays untouched while the feature is workspace-scoped. When per-document
 * ACLs land, this map and the lookups below are the only things that change —
 * every document route already funnels through this file.
 */
const ACTION_TO_TASK_PERMISSION: Record<DocumentAction, string[]> = {
  read: ["read"],
  create: ["create"],
  update: ["update"],
  delete: ["delete"],
};

async function readJsonObjectBody(
  c: Context,
): Promise<Record<string, unknown>> {
  const raw = (await c.req.json().catch(() => ({}))) || {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

/**
 * Only the path param and the JSON body are accepted. Reading the id from the
 * query string would let a caller authorize against one resource
 * (`?id=<mine>`) while the handler acted on another (`{"id": "<theirs>"}`) —
 * the same hole `workspace-access-middleware` documents.
 */
async function resolveId(c: Context, idKey: string): Promise<string | null> {
  const fromParam = c.req.param(idKey);
  if (fromParam) return fromParam;

  const body = await readJsonObjectBody(c);
  const fromBody = body[idKey];
  return typeof fromBody === "string" && fromBody ? fromBody : null;
}

async function workspaceIdForDocument(
  documentId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.documentTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.documentTable.projectId, schema.projectTable.id),
    )
    .where(eq(schema.documentTable.id, documentId))
    .limit(1);

  return row?.workspaceId ?? null;
}

async function workspaceIdForProject(
  projectId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);

  return row?.workspaceId ?? null;
}

function documentAccessMiddleware(
  idKey: string,
  action: DocumentAction,
  lookup: (id: string) => Promise<string | null>,
  notFoundMessage: string,
) {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const id = await resolveId(c, idKey);
    if (!id) {
      throw new HTTPException(400, {
        message: `Missing ${idKey}`,
      });
    }

    const workspaceId = await lookup(id);
    if (!workspaceId) {
      throw new HTTPException(404, { message: notFoundMessage });
    }

    const apiKey = c.get("apiKey");
    await validateWorkspaceAccess(userId, workspaceId, apiKey?.id);

    c.set("workspaceId", workspaceId);

    const granted = await hasWorkspacePermission(c, {
      task: ACTION_TO_TASK_PERMISSION[action],
    });
    if (!granted) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    return next();
  };
}

export const requireDocumentAccess = {
  /** Resolves the workspace through document -> project. */
  fromDocumentId: (action: DocumentAction, idKey = "id") =>
    documentAccessMiddleware(
      idKey,
      action,
      workspaceIdForDocument,
      "Document not found",
    ),

  /** Resolves the workspace directly from a project, for create and list. */
  fromProjectId: (action: DocumentAction, idKey = "projectId") =>
    documentAccessMiddleware(
      idKey,
      action,
      workspaceIdForProject,
      "Project not found",
    ),
};
