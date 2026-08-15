import { client } from "@kaneo/libs";

async function getDocument(id: string) {
  const response = await client.document[":id"].$get({ param: { id } });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default getDocument;
