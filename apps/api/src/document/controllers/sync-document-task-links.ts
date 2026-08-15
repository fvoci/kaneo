import { and, eq, inArray } from "drizzle-orm";
import type db from "../../database";
import {
  documentTaskLinkTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { parseTaskLinkIds } from "../../utils/parse-task-links";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Brings `document_task_link` in line with the links a document body contains.
 *
 * Two filters run before anything is written, and both matter:
 *
 *  - The body is re-parsed and intersected with the ids the client sent, so a
 *    link can only exist for a task the document actually references.
 *  - Surviving ids are checked against the document's own workspace. Without
 *    this a caller could post an id from another workspace and have their
 *    document title appear in that workspace's backlink panel.
 *
 * Runs on the caller's transaction so the content write and the links it
 * implies commit together.
 */
async function syncDocumentTaskLinks({
  tx,
  documentId,
  workspaceId,
  content,
  taskIds,
}: {
  tx: DbOrTx;
  documentId: string;
  workspaceId: string;
  content: string | null;
  taskIds?: string[];
}) {
  const inBody = new Set(parseTaskLinkIds(content));

  // The client tells us what it saw; the body decides what is allowed. When the
  // client says nothing, the body alone is authoritative.
  const requested = taskIds
    ? [...new Set(taskIds.filter((id) => inBody.has(id)))]
    : [...inBody];

  const allowed =
    requested.length > 0
      ? (
          await tx
            .select({ id: taskTable.id })
            .from(taskTable)
            .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
            .where(
              and(
                inArray(taskTable.id, requested),
                eq(projectTable.workspaceId, workspaceId),
              ),
            )
        ).map((row) => row.id)
      : [];

  const allowedSet = new Set(allowed);

  const existing = (
    await tx
      .select({ taskId: documentTaskLinkTable.taskId })
      .from(documentTaskLinkTable)
      .where(eq(documentTaskLinkTable.documentId, documentId))
  ).map((row) => row.taskId);

  const existingSet = new Set(existing);

  const removed = existing.filter((id) => !allowedSet.has(id));
  const added = allowed.filter((id) => !existingSet.has(id));

  if (removed.length > 0) {
    await tx
      .delete(documentTaskLinkTable)
      .where(
        and(
          eq(documentTaskLinkTable.documentId, documentId),
          inArray(documentTaskLinkTable.taskId, removed),
        ),
      );
  }

  if (added.length > 0) {
    await tx
      .insert(documentTaskLinkTable)
      .values(added.map((taskId) => ({ documentId, taskId })))
      .onConflictDoNothing();
  }

  // Websockets are scoped per project, and a document may link a task in
  // another project of the same workspace. Both the tasks that stayed linked
  // and the ones just unlinked have a backlink list that changed, so their
  // projects need telling.
  const touched = [...new Set([...allowed, ...removed])];
  const affectedProjectIds =
    touched.length > 0
      ? [
          ...new Set(
            (
              await tx
                .select({ projectId: taskTable.projectId })
                .from(taskTable)
                .where(inArray(taskTable.id, touched))
            ).map((row) => row.projectId),
          ),
        ]
      : [];

  return { linked: allowed, removed, added, affectedProjectIds };
}

export default syncDocumentTaskLinks;
