import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateDocument, {
  DocumentVersionConflictError,
} from "@/fetchers/document/update-document";

/**
 * On conflict the server copy is authoritative, so the cached document is
 * invalidated rather than patched: the next read pulls whatever the other
 * editor saved, and the caller decides how to tell the user.
 */
function useUpdateDocument(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateDocument,
    onSuccess: (data) => {
      queryClient.setQueryData(["document", data.id], data);
      void queryClient.invalidateQueries({
        queryKey: ["documents", projectId],
      });
    },
    onError: (error, variables) => {
      if (error instanceof DocumentVersionConflictError) {
        void queryClient.invalidateQueries({
          queryKey: ["document", variables.id],
        });
        void queryClient.invalidateQueries({
          queryKey: ["documents", projectId],
        });
      }
    },
  });
}

export default useUpdateDocument;
