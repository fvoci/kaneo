import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteDocument from "@/fetchers/document/delete-document";

function useDeleteDocument(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: ["document", id] });
      void queryClient.invalidateQueries({
        queryKey: ["documents", projectId],
      });
      // An archived document drops out of every backlink list.
      void queryClient.invalidateQueries({ queryKey: ["task-documents"] });
    },
  });
}

export default useDeleteDocument;
