import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { documentTable } from "../../database/schema";

/**
 * Optimistic concurrency.
 *
 * The version guard lives in the WHERE clause so the check and the write are a
 * single atomic statement. Reading the row first and comparing in JS would
 * leave a window where two updates both pass the check and the later one
 * silently discards the earlier edit.
 */
async function updateDocument({
  id,
  title,
  content,
  version,
  currentUserId,
}: {
  id: string;
  title: string;
  content?: string | null;
  version: number;
  currentUserId: string;
}) {
  const [updated] = await db
    .update(documentTable)
    .set({
      title,
      // Only touch the body when the caller sent one, so a title-only update
      // does not blank the document.
      ...(content !== undefined ? { content } : {}),
      updatedBy: currentUserId,
      version: sql`${documentTable.version} + 1`,
    })
    .where(
      and(
        eq(documentTable.id, id),
        eq(documentTable.version, version),
        isNull(documentTable.archivedAt),
      ),
    )
    .returning();

  if (updated) {
    return updated;
  }

  // Zero rows means the guard failed. Only now is a second read worth paying
  // for, to tell "gone" apart from "someone else got there first".
  const [existing] = await db
    .select({
      version: documentTable.version,
      archivedAt: documentTable.archivedAt,
    })
    .from(documentTable)
    .where(eq(documentTable.id, id))
    .limit(1);

  if (!existing || existing.archivedAt) {
    throw new HTTPException(404, { message: "Document not found" });
  }

  throw new HTTPException(409, {
    res: Response.json(
      {
        message: "Document was modified by someone else",
        currentVersion: existing.version,
      },
      { status: 409 },
    ),
  });
}

export default updateDocument;
