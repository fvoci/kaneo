import { client } from "@kaneo/libs";

async function deleteDocument(id: string) {
  const response = await client.document[":id"].$delete({ param: { id } });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default deleteDocument;
