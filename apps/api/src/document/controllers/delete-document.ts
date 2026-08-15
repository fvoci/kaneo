import { eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  documentTable,
  documentTaskLinkTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The documents that go with this one: itself and every descendant still
 * visible.
 *
 * A branch that is already archived is skipped rather than walked, and that is
 * load-bearing rather than an optimisation. Archived rows keep the timestamp
 * they were archived with, which is what will let a future restore tell one
 * archive operation from another. Walking into a branch archived last Tuesday
 * would stamp it with today's, and a restore of this document would then drag
 * that branch back up with it.
 *
 * Skipping the branch loses nothing: everything under an archived document is
 * archived too, because archiving cascades and nothing can be moved under an
 * archived parent.
 *
 * The depth guard is for the case where that invariant is wrong anyway. A cycle
 * in `parent_id` would otherwise make this recurse until the request died.
 */
async function visibleSubtreeIds(dbOrTx: DbOrTx, id: string) {
  const result = await dbOrTx.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT ${documentTable.id}, 0 AS depth
      FROM ${documentTable}
      WHERE ${documentTable.id} = ${id}
        AND ${documentTable.archivedAt} IS NULL
      UNION ALL
      SELECT d.id, s.depth + 1
      FROM ${documentTable} d
      JOIN subtree s ON d.parent_id = s.id
      WHERE d.archived_at IS NULL
        AND s.depth < 32
    )
    SELECT id FROM subtree
  `);

  return (result.rows as { id: string }[]).map((row) => row.id);
}

/**
 * Soft delete, and it takes the subtree with it. Archiving only the document
 * asked for would leave its children in the list pointing at a parent that is
 * no longer in it, so every surface that reads the tree would have to invent a
 * rule for orphans. Taking the subtree keeps one invariant instead: a visible
 * document's parent is either nothing or another visible document.
 *
 * Rows stay so the cross-references, versions and comments that later phases
 * hang off a document are not destroyed by a misclick, and so "deleted" stays
 * reversible. Archived documents are invisible to every read path, and deleting
 * one twice reads as missing.
 */
async function deleteDocument({
  id,
  currentUserId,
}: {
  id: string;
  currentUserId: string;
}) {
  const { document, affectedProjectIds } = await db.transaction(async (tx) => {
    // One value for the whole subtree, not one per row. A restore identifies
    // what this operation archived by matching the timestamp it wrote, so rows
    // archived together have to carry the same one.
    const archivedAt = new Date();

    const ids = await visibleSubtreeIds(tx, id);

    if (ids.length === 0) {
      throw new HTTPException(404, { message: "Document not found" });
    }

    // Every task the subtree references, not just this document's own. A
    // descendant's backlink panel lives on its task's project channel, and
    // leaving that project out means the panel keeps listing a document that
    // has just gone.
    const affected = await tx
      .selectDistinct({ projectId: taskTable.projectId })
      .from(documentTaskLinkTable)
      .innerJoin(taskTable, eq(documentTaskLinkTable.taskId, taskTable.id))
      .where(inArray(documentTaskLinkTable.documentId, ids));

    const archived = await tx
      .update(documentTable)
      .set({ archivedAt, updatedBy: currentUserId })
      .where(inArray(documentTable.id, ids))
      .returning();

    const target = archived.find((row) => row.id === id);

    if (!target) {
      throw new HTTPException(404, { message: "Document not found" });
    }

    return {
      document: target,
      affectedProjectIds: affected.map((row) => row.projectId),
    };
  });

  // Published after the commit, so a failed archive never announces itself.
  // The message names only the document that was asked for; clients refresh the
  // project's whole list from it, which is what removes the descendants too.
  await publishEvent("document.deleted", {
    documentId: document.id,
    projectId: document.projectId,
    affectedProjectIds,
    userId: currentUserId,
  });

  return document;
}

export default deleteDocument;
