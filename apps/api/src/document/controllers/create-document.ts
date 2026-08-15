import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { documentTable } from "../../database/schema";
import syncDocumentTaskLinks from "./sync-document-task-links";

async function createDocument({
  projectId,
  title,
  content,
  taskIds,
  currentUserId,
  workspaceId,
}: {
  projectId: string;
  title: string;
  content?: string;
  taskIds?: string[];
  currentUserId: string;
  workspaceId: string;
}) {
  // Same transaction as the update path: a document and the links its body
  // implies become visible together.
  return db.transaction(async (tx) => {
    const [document] = await tx
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

    await syncDocumentTaskLinks({
      tx,
      documentId: document.id,
      workspaceId,
      content: document.content,
      taskIds,
    });

    return document;
  });
}

export default createDocument;
