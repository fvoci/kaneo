import { useQuery } from "@tanstack/react-query";
import getDocument from "@/fetchers/document/get-document";

export function useGetDocument(id: string | undefined) {
  return useQuery({
    queryKey: ["document", id],
    queryFn: () => getDocument(id ?? ""),
    enabled: !!id,
  });
}
