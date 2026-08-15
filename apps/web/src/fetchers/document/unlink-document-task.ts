import { client } from "@kaneo/libs";

async function unlinkDocumentTask({
  documentId,
  taskId,
}: {
  documentId: string;
  taskId: string;
}) {
  const response = await client.document[":id"].tasks[":taskId"].$delete({
    param: { id: documentId, taskId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default unlinkDocumentTask;
