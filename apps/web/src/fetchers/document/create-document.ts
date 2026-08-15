import { client } from "@kaneo/libs";

async function createDocument({
  projectId,
  title,
  content,
}: {
  projectId: string;
  title: string;
  content?: string;
}) {
  const response = await client.document.project[":projectId"].$post({
    param: { projectId },
    json: {
      title,
      ...(content !== undefined ? { content } : {}),
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default createDocument;
