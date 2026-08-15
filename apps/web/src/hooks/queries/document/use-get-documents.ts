import { useQuery } from "@tanstack/react-query";
import getDocuments from "@/fetchers/document/get-documents";

export function useGetDocuments(projectId: string) {
  return useQuery({
    queryKey: ["documents", projectId],
    queryFn: () => getDocuments(projectId),
    enabled: !!projectId,
    // Documents change from screens this query is not mounted on, and the
    // client-wide `refetchOnMount: false` would serve whatever was cached
    // before that edit. Correctness here cannot wait for a websocket.
    refetchOnMount: "always" as const,
    staleTime: 0,
  });
}
