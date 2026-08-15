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
    },
  });
}

export default useDeleteDocument;
