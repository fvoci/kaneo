import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { documentTable } from "../../database/schema";
import { publishEvent } from "../../events";
import claimDocumentNumber from "./claim-document-number";

/**
 * The claim and the insert share a transaction: a number handed out for a
 * document that then fails to insert would be spent on nothing, leaving a hole
 * in the project's sequence.
 */
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
  const document = await db.transaction(async (tx) => {
    const number = await claimDocumentNumber(projectId, tx);

    const [created] = await tx
      .insert(documentTable)
      .values({
        projectId,
        number,
        title,
        content: content ?? null,
        createdBy: currentUserId,
        updatedBy: currentUserId,
      })
      .returning();

    if (!created) {
      throw new HTTPException(500, { message: "Failed to create document" });
    }

    return created;
  });

  await publishEvent("document.created", {
    documentId: document.id,
    projectId: document.projectId,
    userId: currentUserId,
  });

  return document;
}

export default createDocument;
