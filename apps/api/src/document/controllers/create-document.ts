import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { documentTable } from "../../database/schema";

async function createDocument({
  projectId,
  title,
  content,
  currentUserId,
}: {
  projectId: string;
  title: string;
  content?: string;
  currentUserId: string;
}) {
  const [document] = await db
    .insert(documentTable)
    .values({
      projectId,
      title,
      content: content ?? null,
      createdBy: currentUserId,
      updatedBy: currentUserId,
    })
    .returning();

  if (!document) {
    throw new HTTPException(500, { message: "Failed to create document" });
  }

  return document;
}

export default createDocument;
