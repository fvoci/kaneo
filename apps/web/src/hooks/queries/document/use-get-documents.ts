import { useQuery } from "@tanstack/react-query";
import getDocuments from "@/fetchers/document/get-documents";

export function useGetDocuments(projectId: string) {
  return useQuery({
    queryKey: ["documents", projectId],
    queryFn: () => getDocuments(projectId),
    enabled: !!projectId,
  });
}
