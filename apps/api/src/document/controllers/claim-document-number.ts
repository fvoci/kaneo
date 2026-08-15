import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Claims the next document number for a project, the way tasks claim theirs.
 *
 * The counter is read and advanced by one statement, so two documents created
 * at the same moment cannot be handed the same number. Reading the current
 * value and writing value + 1 would leave a window where both see the same
 * number and one of them loses the unique constraint.
 *
 * Numbers are never reused: a deleted or archived document keeps its own, so a
 * reference written down elsewhere still points at what it always did.
 */
async function claimDocumentNumber(projectId: string, dbOrTx: DbOrTx = db) {
  const [updated] = await dbOrTx
    .update(projectTable)
    .set({
      lastDocumentNumber: sql`${projectTable.lastDocumentNumber} + 1`,
    })
    .where(eq(projectTable.id, projectId))
    .returning({ lastDocumentNumber: projectTable.lastDocumentNumber });

  if (!updated) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  return updated.lastDocumentNumber;
}

export default claimDocumentNumber;
