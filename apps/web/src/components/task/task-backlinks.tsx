import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, FileText, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import LinkPicker, {
  type LinkPickerItem,
} from "@/components/common/link-picker";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import useLinkDocumentTask from "@/hooks/mutations/document/use-link-document-task";
import useUnlinkDocumentTask from "@/hooks/mutations/document/use-unlink-document-task";
import { useGetDocuments } from "@/hooks/queries/document/use-get-documents";
import { useGetTaskDocuments } from "@/hooks/queries/document/use-get-task-documents";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { documentKey } from "@/lib/document-key";
import { toast } from "@/lib/toast";

type TaskBacklinksProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
};

/**
 * The task side of a document reference. Both sides read and write the same
 * `document_task_link` row, so linking here and linking from the document are
 * the same act seen from opposite ends.
 */
export default function TaskBacklinks({
  taskId,
  projectId,
  workspaceId,
}: TaskBacklinksProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(true);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const { data: documents = [] } = useGetTaskDocuments(taskId);
  const { data: projectDocuments = [] } = useGetDocuments(projectId);
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { canManageTasks } = useWorkspacePermission();
  const canEdit = canManageTasks();

  const linkDocument = useLinkDocumentTask();
  const unlinkDocument = useUnlinkDocumentTask();

  const linkedIds = useMemo(
    () => new Set(documents.map((document) => document.id)),
    [documents],
  );

  // The picker offers this project's documents. The API accepts any document
  // whose workspace matches, so one linked elsewhere still lists and unlinks
  // here.
  const candidates = useMemo<LinkPickerItem[]>(
    () =>
      projectDocuments
        .filter((document) => !linkedIds.has(document.id))
        .map((document) => {
          const key = documentKey(project?.slug, document.number);
          return {
            id: document.id,
            value: `${key ?? ""} ${document.title}`,
            label: document.title || t("documents:untitled"),
            hint: key,
            icon: (
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            ),
          };
        }),
    [projectDocuments, linkedIds, project?.slug, t],
  );

  const openDocument = (documentId: string, documentProjectId: string) => {
    void navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/documents/$documentId",
      params: { workspaceId, projectId: documentProjectId, documentId },
    });
  };

  const handleLink = (documentId: string) => {
    setIsPickerOpen(false);
    linkDocument.mutate(
      { documentId, taskId },
      { onError: () => toast.error(t("documents:backlinks.linkFailed")) },
    );
  };

  const handleUnlink = (documentId: string) => {
    unlinkDocument.mutate(
      { documentId, taskId },
      { onError: () => toast.error(t("documents:backlinks.unlinkFailed")) },
    );
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
              >
                {isOpen ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                <span>{t("documents:backlinks.title")}</span>
              </button>
            </CollapsibleTrigger>
            {documents.length > 0 && (
              <span className="text-muted-foreground text-xs">
                {documents.length}
              </span>
            )}
          </div>
          {canEdit && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => setIsPickerOpen(true)}
              aria-label={t("documents:backlinks.add")}
            >
              <Plus className="size-3.5" />
            </Button>
          )}
        </div>

        <CollapsibleContent>
          <ul className="mt-1 flex flex-col gap-0.5">
            {documents.map((document) => {
              const key = documentKey(document.projectSlug, document.number);
              return (
                <ContextMenu key={document.id}>
                  <ContextMenuTrigger asChild>
                    <li>
                      <Link
                        to="/dashboard/workspace/$workspaceId/project/$projectId/documents/$documentId"
                        params={{
                          workspaceId,
                          projectId: document.projectId,
                          documentId: document.id,
                        }}
                        className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent/50"
                      >
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        {key && (
                          <span className="shrink-0 font-mono text-muted-foreground text-xs">
                            {key}
                          </span>
                        )}
                        <span className="truncate text-sm">
                          {document.title || t("documents:untitled")}
                        </span>
                      </Link>
                    </li>
                  </ContextMenuTrigger>

                  <ContextMenuContent className="w-40">
                    <ContextMenuItem
                      onClick={() =>
                        openDocument(document.id, document.projectId)
                      }
                    >
                      <span>{t("documents:backlinks.openDocument")}</span>
                    </ContextMenuItem>
                    {canEdit && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="text-destructive"
                          onClick={() => handleUnlink(document.id)}
                        >
                          <span>{t("documents:backlinks.remove")}</span>
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </ul>

          {documents.length === 0 && (
            <p className="px-2 py-1 text-muted-foreground text-xs">
              {t("documents:backlinks.empty")}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>

      <LinkPicker
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        items={candidates}
        groupLabel={t("documents:backlinks.documentsInProject")}
        placeholder={t("documents:backlinks.searchPlaceholder")}
        emptyText={t("documents:backlinks.noDocumentsFound")}
        onSelect={handleLink}
      />
    </>
  );
}
