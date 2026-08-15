import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  documentTable,
  documentTaskLinkTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";

/**
 * Links a document to a task, the way `task_relation` links two tasks: the
 * caller names both sides and a row records the relationship.
 *
 * The task is checked against the document's workspace even though the caller
 * asked for it explicitly — "explicit" describes the user's intent, not the
 * request's trustworthiness, and any id can be posted.
 */
async function linkDocumentTask({
  documentId,
  taskId,
  workspaceId,
  currentUserId,
}: {
  documentId: string;
  taskId: string;
  workspaceId: string;
  currentUserId: string;
}) {
  const [document] = await db
    .select({ id: documentTable.id, projectId: documentTable.projectId })
    .from(documentTable)
    .where(eq(documentTable.id, documentId))
    .limit(1);

  if (!document) {
    throw new HTTPException(404, { message: "Document not found" });
  }

  const [task] = await db
    .select({ id: taskTable.id, projectId: taskTable.projectId })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(eq(taskTable.id, taskId), eq(projectTable.workspaceId, workspaceId)),
    )
    .limit(1);

  if (!task) {
    throw new HTTPException(404, { message: "Task not found" });
  }

  const [link] = await db
    .insert(documentTaskLinkTable)
    .values({ documentId, taskId })
    .onConflictDoNothing()
    .returning();

  if (!link) {
    throw new HTTPException(409, { message: "This link already exists" });
  }

  await publishEvent("document.updated", {
    documentId: document.id,
    projectId: document.projectId,
    // The task may live in another project of the same workspace, and its
    // backlink panel listens on that project's channel.
    affectedProjectIds: [task.projectId],
    userId: currentUserId,
  });

  return link;
}

export default linkDocumentTask;
