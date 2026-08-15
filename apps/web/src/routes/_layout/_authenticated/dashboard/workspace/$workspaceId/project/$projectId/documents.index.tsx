import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useGetDocuments } from "@/hooks/queries/document/use-get-documents";

type DocumentsIndexSearch = {
  /** Legacy selection parameter, kept so older links keep working. */
  documentId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/documents/",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): DocumentsIndexSearch => ({
    documentId:
      typeof search.documentId === "string" ? search.documentId : undefined,
  }),
});

/**
 * `/documents` with nothing selected. Redirects to a document so the address
 * bar always names what is on screen: the one an old `?documentId=` link asked
 * for, otherwise the most recently edited.
 */
function RouteComponent() {
  const { projectId, workspaceId } = Route.useParams();
  const { documentId: legacyDocumentId } = Route.useSearch();
  const navigate = useNavigate();
  const { data: documents } = useGetDocuments(projectId);

  useEffect(() => {
    if (!documents) return;

    const target =
      documents.find((document) => document.id === legacyDocumentId)?.id ??
      documents[0]?.id;
    if (!target) return;

    void navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/documents/$documentId",
      params: { workspaceId, projectId, documentId: target },
      replace: true,
    });
  }, [documents, legacyDocumentId, navigate, workspaceId, projectId]);

  return null;
}
