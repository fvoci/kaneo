import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  documentTable,
  documentTaskLinkTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";

/**
 * Removes a link by its two sides rather than by row id. The pair is unique, so
 * the client never has to carry a row id around just to undo what it did.
 */
async function unlinkDocumentTask({
  documentId,
  taskId,
  currentUserId,
}: {
  documentId: string;
  taskId: string;
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

  // Read the task's project before the row goes, so the backlink panel on that
  // project's channel still gets told.
  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);

  const [removed] = await db
    .delete(documentTaskLinkTable)
    .where(
      and(
        eq(documentTaskLinkTable.documentId, documentId),
        eq(documentTaskLinkTable.taskId, taskId),
      ),
    )
    .returning();

  if (!removed) {
    throw new HTTPException(404, { message: "Link not found" });
  }

  await publishEvent("document.updated", {
    documentId: document.id,
    projectId: document.projectId,
    affectedProjectIds: task ? [task.projectId] : [],
    userId: currentUserId,
  });

  return removed;
}

export default unlinkDocumentTask;
