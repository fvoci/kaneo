import { and, desc, eq, isNull } from "drizzle-orm";
import db from "../../database";
import { documentTable, documentTaskLinkTable } from "../../database/schema";

/**
 * Documents whose body references this task — the reverse of the links a
 * document stores. Archived documents stay hidden here for the same reason
 * they are hidden from the project list.
 */
async function getTaskDocuments(taskId: string) {
  return db
    .select({
      id: documentTable.id,
      projectId: documentTable.projectId,
      title: documentTable.title,
      updatedAt: documentTable.updatedAt,
      linkedAt: documentTaskLinkTable.createdAt,
    })
    .from(documentTaskLinkTable)
    .innerJoin(
      documentTable,
      eq(documentTaskLinkTable.documentId, documentTable.id),
    )
    .where(
      and(
        eq(documentTaskLinkTable.taskId, taskId),
        isNull(documentTable.archivedAt),
      ),
    )
    .orderBy(desc(documentTable.updatedAt));
}

export default getTaskDocuments;
