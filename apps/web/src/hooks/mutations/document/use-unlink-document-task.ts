import { useMutation, useQueryClient } from "@tanstack/react-query";
import unlinkDocumentTask from "@/fetchers/document/unlink-document-task";

function useUnlinkDocumentTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: unlinkDocumentTask,
    onSuccess: (_data, { documentId, taskId }) => {
      void queryClient.invalidateQueries({
        queryKey: ["document-tasks", documentId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["task-documents", taskId],
      });
    },
  });
}

export default useUnlinkDocumentTask;
