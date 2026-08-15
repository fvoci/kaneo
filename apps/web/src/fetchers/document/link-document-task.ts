import { client } from "@kaneo/libs";

async function linkDocumentTask({
  documentId,
  taskId,
}: {
  documentId: string;
  taskId: string;
}) {
  const response = await client.document[":id"].tasks.$post({
    param: { id: documentId },
    json: { taskId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default linkDocumentTask;
