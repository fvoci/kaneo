import { useQuery } from "@tanstack/react-query";
import getDocumentTasks from "@/fetchers/document/get-document-tasks";

export function useGetDocumentTasks(documentId: string | undefined) {
  return useQuery({
    queryKey: ["document-tasks", documentId],
    queryFn: () => getDocumentTasks(documentId ?? ""),
    enabled: !!documentId,
    // References change from the task side too, on a screen this one is not
    // mounted on. The client default of `refetchOnMount: false` would serve the
    // list cached before that edit, so a document could keep showing a task it
    // no longer references — or one that was deleted.
    refetchOnMount: "always" as const,
    staleTime: 0,
  });
}
