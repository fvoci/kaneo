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
    },
  });
}

export default useCreateDocument;
