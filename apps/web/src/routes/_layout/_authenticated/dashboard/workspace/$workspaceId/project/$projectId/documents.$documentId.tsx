import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import DocumentEditor from "@/components/document/document-editor";
import { DocumentVersionConflictError } from "@/fetchers/document/update-document";
import useDeleteDocument from "@/hooks/mutations/document/use-delete-document";
import useUpdateDocument from "@/hooks/mutations/document/use-update-document";
import { useGetDocument } from "@/hooks/queries/document/use-get-document";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/documents/$documentId",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { documentId, projectId, workspaceId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: document } = useGetDocument(documentId);
  const updateDocument = useUpdateDocument(projectId);
  const deleteDocument = useDeleteDocument(projectId);

  // The conflict carries the document it belongs to: the router reuses this
  // component when only the parameter changes, and a conflict from the previous
  // document must not follow the user to the next one.
  const [conflict, setConflict] = useState<{
    documentId: string;
    version: number;
  } | null>(null);
  const conflictVersion =
    conflict && conflict.documentId === documentId ? conflict.version : null;

  const handleSave = (draft: {
    title: string;
    content: string;
    version: number;
    taskIds: string[];
  }) => {
    updateDocument.mutate(
      { id: documentId, ...draft },
      {
        onSuccess: () => setConflict(null),
        onError: (error) => {
          if (error instanceof DocumentVersionConflictError) {
            // Surface the conflict in a banner and keep the draft intact.
            setConflict({ documentId, version: error.currentVersion });
            return;
          }
          toast.error(t("documents:errors.saveFailed"));
        },
      },
    );
  };

  // Only an explicit reload replaces the draft with the server copy.
  const handleReloadAfterConflict = () => {
    setConflict(null);
    void queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    void queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
  };

  const handleDelete = () => {
    deleteDocument.mutate(documentId, {
      // Back to the index, which picks whatever document is left.
      onSuccess: () =>
        void navigate({
          to: "/dashboard/workspace/$workspaceId/project/$projectId/documents",
          params: { workspaceId, projectId },
          replace: true,
        }),
      onError: () => toast.error(t("documents:errors.deleteFailed")),
    });
  };

  if (!document) return null;

  return (
    <DocumentEditor
      key={document.id}
      document={document}
      isSaving={updateDocument.isPending}
      isDeleting={deleteDocument.isPending}
      conflictVersion={conflictVersion}
      onSave={handleSave}
      onDelete={handleDelete}
      onReloadAfterConflict={handleReloadAfterConflict}
    />
  );
}
