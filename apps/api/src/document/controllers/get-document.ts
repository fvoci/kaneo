import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { documentTable } from "../../database/schema";

/**
 * Archived documents read as missing. Authorization already ran, so a caller
 * from another workspace was rejected with 403 before reaching this point and
 * cannot use the 404 to probe for existence.
 */
async function getDocument(id: string) {
  const [document] = await db
    .select()
    .from(documentTable)
    .where(and(eq(documentTable.id, id), isNull(documentTable.archivedAt)))
    .limit(1);

  if (!document) {
    throw new HTTPException(404, { message: "Document not found" });
  }

  return document;
}

export default getDocument;
