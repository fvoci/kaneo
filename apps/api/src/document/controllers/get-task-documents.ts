import { and, desc, eq, isNull } from "drizzle-orm";
import db from "../../database";
import {
  documentTable,
  documentTaskLinkTable,
  projectTable,
} from "../../database/schema";

/**
 * Documents that reference this task, the reverse of the reference list a
 * document shows. Archived documents stay hidden here for the same reason they
 * are hidden from the project list.
 *
 * The project slug comes along because a document in another project of the
 * workspace can reference this task, and its identifier is built from its own
 * project's slug rather than this task's.
 */
async function getTaskDocuments(taskId: string) {
  return db
    .select({
      id: documentTable.id,
      projectId: documentTable.projectId,
      projectSlug: projectTable.slug,
      number: documentTable.number,
      title: documentTable.title,
      updatedAt: documentTable.updatedAt,
      linkedAt: documentTaskLinkTable.createdAt,
    })
    .from(documentTaskLinkTable)
    .innerJoin(
      documentTable,
      eq(documentTaskLinkTable.documentId, documentTable.id),
    )
    .innerJoin(projectTable, eq(documentTable.projectId, projectTable.id))
    .where(
      and(
        eq(documentTaskLinkTable.taskId, taskId),
        isNull(documentTable.archivedAt),
      ),
    )
    .orderBy(desc(documentTable.updatedAt));
}

export default getTaskDocuments;
