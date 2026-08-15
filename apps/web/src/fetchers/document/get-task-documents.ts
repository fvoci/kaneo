import { client } from "@kaneo/libs";

async function getTaskDocuments(taskId: string) {
  const response = await client.document.task[":taskId"].$get({
    param: { taskId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default getTaskDocuments;
