import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { documentTable } from "../../database/schema";

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
  const [archived] = await db
    .update(documentTable)
    .set({ archivedAt: new Date(), updatedBy: currentUserId })
    .where(and(eq(documentTable.id, id), isNull(documentTable.archivedAt)))
    .returning();

  if (!archived) {
    throw new HTTPException(404, { message: "Document not found" });
  }

  return archived;
}

export default deleteDocument;
