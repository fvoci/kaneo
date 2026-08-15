import { useMutation, useQueryClient } from "@tanstack/react-query";
import createDocument from "@/fetchers/document/create-document";

function useCreateDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createDocument,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["documents", variables.projectId],
      });
      // A new document can arrive with links already in its body.
      void queryClient.invalidateQueries({ queryKey: ["task-documents"] });
    },
  });
}

export default useCreateDocument;
