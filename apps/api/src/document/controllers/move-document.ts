import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { documentTable } from "../../database/schema";
import { publishEvent } from "../../events";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Root, child, grandchild. The sidebar runs out of width past this. */
const MAX_DEPTH = 3;

type TreeProbe = {
  moving_found: boolean;
  moving_project_id: string | null;
  moving_parent_id: string | null;
  parent_found: boolean;
  parent_project_id: string | null;
  parent_depth: number;
  subtree_height: number;
  creates_cycle: boolean;
};

/**
 * Everything the move has to know about the tree, in one statement so the
 * answers cannot disagree with each other or with what the write then does.
 *
 * The two recursions are deliberately not symmetric.
 *
 * `descendants` skips archived branches, because what bounds the depth is the
 * subtree a reader can see; an archived branch is not rendered and does not
 * travel with the move in any visible sense.
 *
 * `ancestors` does not skip them. A visible document should never have an
 * archived ancestor — archiving cascades — but if that ever stopped being true,
 * counting the archived ancestor overstates the depth and rejects a move that
 * might have been fine. Skipping it would understate the depth and accept a
 * move that is not. A check that can be wrong should be wrong in the direction
 * of refusing.
 *
 * Both seeds require `archived_at IS NULL`, which is what makes an archived
 * document unmovable and an archived parent unreachable without either being
 * checked for separately.
 */
async function probeTree(
  dbOrTx: DbOrTx,
  id: string,
  parentId: string | null,
): Promise<TreeProbe> {
  const result = await dbOrTx.execute(sql`
    WITH RECURSIVE
    moving AS (
      SELECT id, project_id, parent_id
      FROM ${documentTable}
      WHERE id = ${id} AND archived_at IS NULL
    ),
    ancestors AS (
      SELECT id, parent_id, project_id, 1 AS depth
      FROM ${documentTable}
      WHERE id = ${parentId} AND archived_at IS NULL
      UNION ALL
      SELECT d.id, d.parent_id, d.project_id, a.depth + 1
      FROM ${documentTable} d
      JOIN ancestors a ON d.id = a.parent_id
      WHERE a.depth < 32
    ),
    descendants AS (
      SELECT m.id, 0 AS rel FROM moving m
      UNION ALL
      SELECT d.id, s.rel + 1
      FROM ${documentTable} d
      JOIN descendants s ON d.parent_id = s.id
      WHERE d.archived_at IS NULL AND s.rel < 32
    )
    SELECT
      EXISTS (SELECT 1 FROM moving)                          AS moving_found,
      (SELECT project_id FROM moving)                        AS moving_project_id,
      (SELECT parent_id  FROM moving)                        AS moving_parent_id,
      EXISTS (SELECT 1 FROM ancestors WHERE depth = 1)       AS parent_found,
      (SELECT project_id FROM ancestors WHERE depth = 1)     AS parent_project_id,
      COALESCE((SELECT max(depth) FROM ancestors), 0)        AS parent_depth,
      COALESCE((SELECT max(rel)   FROM descendants), 0)      AS subtree_height,
      EXISTS (SELECT 1 FROM descendants WHERE id = ${parentId}) AS creates_cycle
  `);

  const [row] = result.rows as TreeProbe[];
  if (!row) {
    throw new HTTPException(500, { message: "Failed to inspect the tree" });
  }
  return row;
}

const sameParent = (parentId: string | null) =>
  parentId === null
    ? isNull(documentTable.parentId)
    : eq(documentTable.parentId, parentId);

/**
 * The visible siblings of a group, in the order the list renders them. Archived
 * rows are left out and are never renumbered: they are not in the ordering a
 * reader manipulates, so a move has no business rewriting their rank.
 */
async function visibleSiblings(
  dbOrTx: DbOrTx,
  projectId: string,
  parentId: string | null,
) {
  return dbOrTx
    .select({ id: documentTable.id, position: documentTable.position })
    .from(documentTable)
    .where(
      and(
        eq(documentTable.projectId, projectId),
        sameParent(parentId),
        isNull(documentTable.archivedAt),
      ),
    )
    .orderBy(
      asc(documentTable.position),
      asc(documentTable.createdAt),
      asc(documentTable.id),
    );
}

/** Writes 0..n-1 over a group, touching only the rows whose rank changed. */
async function renumber(
  dbOrTx: DbOrTx,
  ordered: { id: string; position: number }[],
) {
  for (const [index, row] of ordered.entries()) {
    if (row.position === index) continue;
    await dbOrTx
      .update(documentTable)
      .set({ position: index })
      .where(eq(documentTable.id, row.id));
  }
}

/**
 * Moves a document under a new parent, to a new rank among its siblings, or
 * both. Reparenting and reordering are the same operation because a drag is:
 * the pointer lands somewhere, and where it lands decides both.
 *
 * The client sends where it wants the document, not what every position should
 * become. Positions are derived here, the way `reorderProjects` derives its
 * own, so the stored ranks cannot develop gaps or duplicates from a payload
 * that was computed against a stale tree.
 */
async function moveDocument({
  id,
  parentId,
  position,
  currentUserId,
}: {
  id: string;
  parentId: string | null;
  position: number;
  currentUserId: string;
}) {
  const moved = await db.transaction(async (tx) => {
    // Read once before the lock purely to learn which project to lock. Nothing
    // is decided from it — every check below runs against the probe taken after
    // the lock is held. A document cannot change project, so the key is stable
    // even if the row moves under us in between.
    const [existing] = await tx
      .select({ projectId: documentTable.projectId })
      .from(documentTable)
      .where(and(eq(documentTable.id, id), isNull(documentTable.archivedAt)))
      .limit(1);

    if (!existing) {
      throw new HTTPException(404, { message: "Document not found" });
    }

    // The key `createDocument` and the archive both take, so appending,
    // archiving and reordering a project's documents are serialized against
    // each other. One key is enough because a move cannot leave the project —
    // the parent-project check below is what guarantees that. Allowing
    // cross-project moves later would mean taking both keys in a fixed order,
    // or two moves in opposite directions would deadlock.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(1525, hashtext(${existing.projectId}))`,
    );

    const probe = await probeTree(tx, id, parentId);

    if (!probe.moving_found || !probe.moving_project_id) {
      throw new HTTPException(404, { message: "Document not found" });
    }

    if (parentId !== null && !probe.parent_found) {
      // Covers both a parent that never existed and one that has been
      // archived: the probe's seed refuses to start from an archived row, so a
      // parent nobody can see is a parent nobody can move under.
      throw new HTTPException(404, { message: "Parent document not found" });
    }

    // Whether the request names a parent at all is the caller's intent, not a
    // fact about the tree, so it is read here rather than asked of SQL — `id =
    // NULL` matches nothing, which makes "move to the root" and "that parent
    // does not exist" produce identical rows.
    const parentDepth = parentId === null ? 0 : probe.parent_depth;

    if (
      parentId !== null &&
      probe.parent_project_id !== probe.moving_project_id
    ) {
      throw new HTTPException(400, {
        message: "A document can only be nested under one in the same project",
      });
    }

    if (probe.creates_cycle) {
      throw new HTTPException(409, {
        message: "A document cannot be moved inside itself",
      });
    }

    if (parentDepth + 1 + probe.subtree_height > MAX_DEPTH) {
      throw new HTTPException(409, {
        message: `Documents can only nest ${MAX_DEPTH} levels deep`,
      });
    }

    const projectId = probe.moving_project_id;
    const staysInGroup = probe.moving_parent_id === parentId;

    const destination = (await visibleSiblings(tx, projectId, parentId)).filter(
      (row) => row.id !== id,
    );

    // Clamped rather than rejected: a client computing an index against a tree
    // that has since changed is ordinary, and the nearest legal slot is what it
    // meant.
    const slot = Math.max(
      0,
      Math.min(Math.trunc(position), destination.length),
    );
    destination.splice(slot, 0, { id, position: slot });

    if (!staysInGroup) {
      const source = await visibleSiblings(
        tx,
        projectId,
        probe.moving_parent_id,
      );
      await renumber(
        tx,
        source.filter((row) => row.id !== id),
      );
    }

    await renumber(tx, destination);

    const [updated] = await tx
      .update(documentTable)
      .set({ parentId, position: slot, updatedBy: currentUserId })
      .where(eq(documentTable.id, id))
      .returning();

    if (!updated) {
      throw new HTTPException(404, { message: "Document not found" });
    }

    return updated;
  });

  await publishEvent("document.updated", {
    documentId: moved.id,
    projectId: moved.projectId,
    userId: currentUserId,
  });

  return moved;
}

export default moveDocument;
