import { and, asc, eq, isNull } from "drizzle-orm";
import db from "../../database";
import { documentTable } from "../../database/schema";

/**
 * Flat list for a project, in the order the tree will render it. Ordering by
 * `position` rather than `updatedAt` is what keeps a document where the reader
 * left it: editing one used to move it to the top and push everything else
 * down, so the list reordered itself under anyone who was reading it.
 *
 * `createdAt` and `id` break ties the way `reorderProjects` breaks its own.
 * They are not decoration: every document created before positions existed
 * holds the default, and two documents can share a rank until a reorder
 * renumbers the group. Without them Postgres is free to return tied rows in
 * any order, and a list that shuffles on refresh is the bug this ordering is
 * meant to remove.
 */
async function getDocuments(projectId: string) {
  return db
    .select({
      id: documentTable.id,
      projectId: documentTable.projectId,
      parentId: documentTable.parentId,
      position: documentTable.position,
      number: documentTable.number,
      title: documentTable.title,
      createdAt: documentTable.createdAt,
      updatedAt: documentTable.updatedAt,
    })
    .from(documentTable)
    .where(
      and(
        eq(documentTable.projectId, projectId),
        isNull(documentTable.archivedAt),
      ),
    )
    .orderBy(
      asc(documentTable.position),
      asc(documentTable.createdAt),
      asc(documentTable.id),
    );
}

export default getDocuments;
