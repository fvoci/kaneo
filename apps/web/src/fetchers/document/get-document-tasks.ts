import { client } from "@kaneo/libs";

async function getDocumentTasks(documentId: string) {
  const response = await client.document[":id"].tasks.$get({
    param: { id: documentId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default getDocumentTasks;
