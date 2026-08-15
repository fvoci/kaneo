import { desc, eq } from "drizzle-orm";
import db from "../../database";
import {
  documentTaskLinkTable,
  projectTable,
  taskTable,
} from "../../database/schema";

/**
 * Tasks a document references. Carries exactly what the reference list renders
 * — a status icon, the issue key and the title — so the UI does not have to
 * fetch each task separately. Most recently linked first.
 */
async function getDocumentTasks(documentId: string) {
  return db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      status: taskTable.status,
      projectId: taskTable.projectId,
      projectSlug: projectTable.slug,
    })
    .from(documentTaskLinkTable)
    .innerJoin(taskTable, eq(documentTaskLinkTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(documentTaskLinkTable.documentId, documentId))
    .orderBy(desc(documentTaskLinkTable.createdAt));
}

export default getDocumentTasks;
