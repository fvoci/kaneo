import { useQuery } from "@tanstack/react-query";
import getDocument from "@/fetchers/document/get-document";

export function useGetDocument(id: string | undefined) {
  return useQuery({
    queryKey: ["document", id],
    queryFn: () => getDocument(id ?? ""),
    enabled: !!id,
    // Documents change from screens this query is not mounted on, and the
    // client-wide `refetchOnMount: false` would serve whatever was cached
    // before that edit. Correctness here cannot wait for a websocket.
    refetchOnMount: "always" as const,
    staleTime: 0,
  });
}
