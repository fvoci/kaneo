import { useQuery } from "@tanstack/react-query";
import getTaskDocuments from "@/fetchers/document/get-task-documents";

export function useGetTaskDocuments(taskId: string | undefined) {
  return useQuery({
    queryKey: ["task-documents", taskId],
    queryFn: () => getTaskDocuments(taskId ?? ""),
    enabled: !!taskId,
    // Backlinks change from the document side, on a screen this one is not
    // mounted on. The client default of `refetchOnMount: false` would serve the
    // list cached before that edit, so a task could keep showing a document
    // that no longer references it — or was deleted.
    refetchOnMount: "always" as const,
    staleTime: 0,
  });
}
