import { client } from "@kaneo/libs";

/**
 * Thrown when the API rejects a write because the document moved on while this
 * editor was typing. `currentVersion` is the version now stored, so the UI can
 * tell the user how far behind they are and offer to reload.
 */
export class DocumentVersionConflictError extends Error {
  readonly currentVersion: number;

  constructor(currentVersion: number) {
    super("Document was modified by someone else");
    this.name = "DocumentVersionConflictError";
    this.currentVersion = currentVersion;
  }
}

async function updateDocument({
  id,
  title,
  content,
  version,
  taskIds,
}: {
  id: string;
  title: string;
  content?: string | null;
  version: number;
  taskIds?: string[];
}) {
  const response = await client.document[":id"].$put({
    param: { id },
    json: {
      title,
      version,
      ...(content !== undefined ? { content } : {}),
      ...(taskIds ? { taskIds } : {}),
    },
  });

  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as {
      currentVersion?: number;
    } | null;
    throw new DocumentVersionConflictError(body?.currentVersion ?? version);
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default updateDocument;
