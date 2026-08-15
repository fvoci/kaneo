import { useMutation, useQueryClient } from "@tanstack/react-query";
import linkDocumentTask from "@/fetchers/document/link-document-task";

function useLinkDocumentTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: linkDocumentTask,
    onSuccess: (_data, { documentId, taskId }) => {
      void queryClient.invalidateQueries({
        queryKey: ["document-tasks", documentId],
      });
      // The link is one row seen from two sides; the task's backlink panel
      // shows the other one.
      void queryClient.invalidateQueries({
        queryKey: ["task-documents", taskId],
      });
    },
  });
}

export default useLinkDocumentTask;
