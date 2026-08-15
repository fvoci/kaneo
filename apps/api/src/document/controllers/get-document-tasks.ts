import { desc, eq } from "drizzle-orm";
import db from "../../database";
import {
  documentTaskLinkTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";

/**
 * Tasks a document references. Carries the fields the reference list renders —
 * the same shape `getTaskRelations` returns for related tasks — so the UI does
 * not have to fetch each task separately.
 */
async function getDocumentTasks(documentId: string) {
  return db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      status: taskTable.status,
      priority: taskTable.priority,
      projectId: taskTable.projectId,
      projectSlug: projectTable.slug,
      assigneeName: userTable.name,
      linkedAt: documentTaskLinkTable.createdAt,
    })
    .from(documentTaskLinkTable)
    .innerJoin(taskTable, eq(documentTaskLinkTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(eq(documentTaskLinkTable.documentId, documentId))
    .orderBy(desc(documentTaskLinkTable.createdAt));
}

export default getDocumentTasks;
