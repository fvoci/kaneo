import {
  createFileRoute,
  Outlet,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import DocumentEmptyState from "@/components/document/document-empty-state";
import DocumentList from "@/components/document/document-list";
import PageTitle from "@/components/page-title";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import useCreateDocument from "@/hooks/mutations/document/use-create-document";
import useDeleteDocument from "@/hooks/mutations/document/use-delete-document";
import { useGetDocuments } from "@/hooks/queries/document/use-get-documents";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import type { DocumentSummary } from "@/types/document";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/documents",
)({
  component: RouteComponent,
});

/**
 * Shell for the documents view: the project chrome and the list of documents.
 * Which document is open is a path parameter handled by the child route, so a
 * document has a URL that survives a reload and can be linked to.
 */
function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const navigate = useNavigate();

  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { data: documents, isLoading, isError } = useGetDocuments(projectId);
  const createDocument = useCreateDocument();
  const deleteDocument = useDeleteDocument(projectId);
  const { canManageTasks } = useWorkspacePermission();

  // Deleting is offered from the list, so the dialog lives here rather than in
  // the editor: a document can be deleted without being open.
  const [deleteTarget, setDeleteTarget] = useState<DocumentSummary | null>(
    null,
  );

  useEffect(() => {
    if (isError) toast.error(t("documents:errors.loadFailed"));
  }, [isError, t]);

  const openDocument = (documentId: string) => {
    void navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/documents/$documentId",
      params: { workspaceId, projectId, documentId },
    });
  };

  const handleCreate = () => {
    createDocument.mutate(
      { projectId, title: t("documents:untitled"), content: "" },
      {
        onSuccess: (created) => openDocument(created.id),
        onError: () => toast.error(t("documents:errors.createFailed")),
      },
    );
  };

  // The open document lives in the child route's params; `strict: false` reads
  // them from the deepest match without this route having to declare them.
  const { documentId: selectedId } = useParams({ strict: false });

  const handleDelete = () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);

    deleteDocument.mutate(targetId, {
      // Only the open document needs the redirect; deleting any other one
      // leaves the current view alone.
      onSuccess: () => {
        if (targetId !== selectedId) return;
        void navigate({
          to: "/dashboard/workspace/$workspaceId/project/$projectId/documents",
          params: { workspaceId, projectId },
          replace: true,
        });
      },
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
                selectedId={selectedId}
                projectSlug={project?.slug}
                canDelete={canManageTasks()}
                onSelect={openDocument}
                onDelete={setDeleteTarget}
              />
            </aside>
            <Outlet />
          </div>
        ) : (
          <DocumentEmptyState
            onCreate={handleCreate}
            isCreating={createDocument.isPending}
          />
        )}
      </ProjectLayout>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("documents:deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("documents:deleteConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("documents:cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                />
              }
            >
              {t("documents:delete")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
