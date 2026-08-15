import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  documentTable,
  documentTaskLinkTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";

/**
 * Soft delete. Rows stay so the cross-references, versions and comments that
 * later phases hang off a document are not destroyed by a misclick, and so
 * "deleted" stays reversible. Archived documents are invisible to every read
 * path, and deleting one twice reads as missing.
 */
async function deleteDocument({
  id,
  currentUserId,
}: {
  id: string;
  currentUserId: string;
}) {
  const { document, affectedProjectIds } = await db.transaction(async (tx) => {
    // Read the linked tasks first: archiving leaves the link rows in place, so
    // this works either way, but reading up front keeps the intent obvious.
    const affected = await tx
      .selectDistinct({ projectId: taskTable.projectId })
      .from(documentTaskLinkTable)
      .innerJoin(taskTable, eq(documentTaskLinkTable.taskId, taskTable.id))
      .where(eq(documentTaskLinkTable.documentId, id));

    const [archived] = await tx
      .update(documentTable)
      .set({ archivedAt: new Date(), updatedBy: currentUserId })
      .where(and(eq(documentTable.id, id), isNull(documentTable.archivedAt)))
      .returning();

    if (!archived) {
      throw new HTTPException(404, { message: "Document not found" });
    }

    return {
      document: archived,
      affectedProjectIds: affected.map((row) => row.projectId),
    };
  });

  // Published after the commit, so a failed archive never announces itself.
  await publishEvent("document.deleted", {
    documentId: document.id,
    projectId: document.projectId,
    affectedProjectIds,
    userId: currentUserId,
  });

  return document;
}

export default deleteDocument;
