import { useQuery } from "@tanstack/react-query";
import getTaskDocuments from "@/fetchers/document/get-task-documents";

export function useGetTaskDocuments(taskId: string | undefined) {
  return useQuery({
    queryKey: ["task-documents", taskId],
    queryFn: () => getTaskDocuments(taskId ?? ""),
    enabled: !!taskId,
  });
}
