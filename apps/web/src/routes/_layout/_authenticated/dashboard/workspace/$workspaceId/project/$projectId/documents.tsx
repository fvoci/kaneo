import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import DocumentEditor from "@/components/document/document-editor";
import DocumentEmptyState from "@/components/document/document-empty-state";
import DocumentList from "@/components/document/document-list";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { DocumentVersionConflictError } from "@/fetchers/document/update-document";
import useCreateDocument from "@/hooks/mutations/document/use-create-document";
import useDeleteDocument from "@/hooks/mutations/document/use-delete-document";
import useUpdateDocument from "@/hooks/mutations/document/use-update-document";
import { useGetDocument } from "@/hooks/queries/document/use-get-document";
import { useGetDocuments } from "@/hooks/queries/document/use-get-documents";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { toast } from "@/lib/toast";

type DocumentsSearchParams = {
  documentId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/documents",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): DocumentsSearchParams => ({
    documentId:
      typeof search.documentId === "string" ? search.documentId : undefined,
  }),
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { documentId } = Route.useSearch();
  const navigate = useNavigate();

  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { data: documents, isLoading, isError } = useGetDocuments(projectId);
  const { data: selectedDocument } = useGetDocument(documentId);

  const createDocument = useCreateDocument();
  const updateDocument = useUpdateDocument(projectId);
  const deleteDocument = useDeleteDocument(projectId);

  const selectDocument = useCallback(
    (nextId: string | undefined) => {
      void navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/documents",
        params: { workspaceId, projectId },
        search: nextId ? { documentId: nextId } : {},
      });
    },
    [navigate, workspaceId, projectId],
  );

  // Keep the selection pointing at something that still exists: on first load,
  // and after a delete removes the open document.
  useEffect(() => {
    if (!documents || documents.length === 0) return;
    const stillExists =
      documentId && documents.some((document) => document.id === documentId);
    if (!stillExists) {
      selectDocument(documents[0]?.id);
    }
  }, [documents, documentId, selectDocument]);

  useEffect(() => {
    if (isError) toast.error(t("documents:errors.loadFailed"));
  }, [isError, t]);

  const handleCreate = () => {
    createDocument.mutate(
      { projectId, title: t("documents:untitled"), content: "" },
      {
        onSuccess: (created) => selectDocument(created.id),
        onError: () => toast.error(t("documents:errors.createFailed")),
      },
    );
  };

  const handleSave = (draft: {
    title: string;
    content: string;
    version: number;
  }) => {
    if (!documentId) return;
    updateDocument.mutate(
      { id: documentId, ...draft },
      {
        onError: (error) => {
          if (error instanceof DocumentVersionConflictError) {
            toast.error(t("documents:errors.conflict"));
            return;
          }
          toast.error(t("documents:errors.saveFailed"));
        },
      },
    );
  };

  const handleDelete = () => {
    if (!documentId) return;
    deleteDocument.mutate(documentId, {
      onSuccess: () => selectDocument(undefined),
      onError: () => toast.error(t("documents:errors.deleteFailed")),
    });
  };

  const hasDocuments = (documents?.length ?? 0) > 0;

  return (
    <>
      <PageTitle
        title={t("documents:pageTitle", { name: project?.name ?? "" })}
      />
      <ProjectLayout
        projectId={projectId}
        workspaceId={workspaceId}
        activeView="documents"
        headerActions={
          hasDocuments ? (
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={createDocument.isPending}
            >
              <Plus className="size-4" />
              {t("documents:new")}
            </Button>
          ) : null
        }
      >
        {isLoading ? null : hasDocuments ? (
          <div className="flex min-h-0 flex-1">
            <aside className="w-64 shrink-0 overflow-auto border-border/80 border-r">
              <DocumentList
                documents={documents ?? []}
                selectedId={documentId}
                onSelect={selectDocument}
              />
            </aside>
            {selectedDocument ? (
              <DocumentEditor
                key={selectedDocument.id}
                document={selectedDocument}
                isSaving={updateDocument.isPending}
                isDeleting={deleteDocument.isPending}
                onSave={handleSave}
                onDelete={handleDelete}
              />
            ) : null}
          </div>
        ) : (
          <DocumentEmptyState
            onCreate={handleCreate}
            isCreating={createDocument.isPending}
          />
        )}
      </ProjectLayout>
    </>
  );
}
