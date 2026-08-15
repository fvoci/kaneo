import { and, desc, eq, isNull } from "drizzle-orm";
import db from "../../database";
import { documentTable } from "../../database/schema";

/**
 * Flat list for a project, most recently edited first. Still ordered by
 * `updatedAt` rather than `position` because nothing assigns a position yet —
 * every row holds the default. The switch belongs with the change that starts
 * ranking siblings.
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
    .orderBy(desc(documentTable.updatedAt));
}

export default getDocuments;
