import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateDocument from "@/fetchers/document/update-document";

/**
 * A conflict deliberately leaves the cache alone. Invalidating here would
 * refetch the server copy into the open editor and overwrite the draft the
 * user has not saved yet; pulling that version is the user's call.
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
      // A save rewrites this document's task links, and the panel that shows
      // them lives on the task side. The affected tasks are decided by the
      // server, so the whole prefix goes stale.
      void queryClient.invalidateQueries({ queryKey: ["task-documents"] });
    },
  });
}

export default useUpdateDocument;
