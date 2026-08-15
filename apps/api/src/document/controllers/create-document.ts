import { and, eq, isNull, max, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { documentTable } from "../../database/schema";
import { publishEvent } from "../../events";
import claimDocumentNumber from "./claim-document-number";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Rank at the end of the sibling group, the way `moveTask` appends to a column.
 *
 * Archived siblings count. Archiving is a soft delete that stays reversible, so
 * skipping them would hand their rank to a new document and leave the two tied
 * the moment one is restored. The gap an archived document leaves behind costs
 * nothing: positions decide order, and nothing reads them as a count.
 *
 * Roots are their own group, which is why the parent is matched with `IS NULL`
 * rather than `=`: in SQL `NULL = NULL` is unknown, so an equality test would
 * match no rows and every root would be created on top of the last one.
 *
 * Ranks start at 0, like `createProject`, not at 1 like `getNextTaskPosition`.
 * The reorder endpoint renumbers a sibling group to 0..n-1 the way
 * `reorderProjects` does, so a 1-based create would shift every rank by one the
 * first time anything was dragged.
 */
async function nextSiblingPosition(
  dbOrTx: DbOrTx,
  projectId: string,
  parentId: string | null,
) {
  const [row] = await dbOrTx
    .select({ maxPosition: max(documentTable.position) })
    .from(documentTable)
    .where(
      and(
        eq(documentTable.projectId, projectId),
        parentId === null
          ? isNull(documentTable.parentId)
          : eq(documentTable.parentId, parentId),
      ),
    );

  return (row?.maxPosition ?? -1) + 1;
}

/**
 * The claim, the rank and the insert share a transaction, so a number handed
 * out for a document that then fails to insert is not spent on nothing, which
 * would leave a hole in the project's sequence.
 *
 * The transaction alone does not settle the rank: under READ COMMITTED two
 * concurrent creates both read the same `max(position)` and land on the same
 * slot, and a create can interleave with a reorder's renumber. The advisory
 * lock is what serializes them, keyed per project the way `createProject` keys
 * its own per workspace.
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
    // Distinct from the 1524 key `createProject` and `reorderProjects` share:
    // that one is keyed by workspace and orders projects, this one is keyed by
    // project and orders documents. The document reorder endpoint will take
    // this same lock with this same key.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(1525, hashtext(${projectId}))`,
    );

    const number = await claimDocumentNumber(projectId, tx);
    // Every document is created as a root until the reorder endpoint can place
    // one in the tree.
    const position = await nextSiblingPosition(tx, projectId, null);

    const [created] = await tx
      .insert(documentTable)
      .values({
        projectId,
        number,
        position,
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
