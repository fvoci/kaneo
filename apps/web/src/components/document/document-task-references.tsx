import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
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
import { useGetDocumentTasks } from "@/hooks/queries/document/use-get-document-tasks";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import { toast } from "@/lib/toast";

type DocumentTaskReferencesProps = {
  documentId: string;
  projectId: string;
  workspaceId: string;
};

type CandidateTask = {
  id: string;
  title: string;
  number: number | null;
  status: string;
};

function issueKey(slug: string | undefined, number: number | null) {
  if (!slug || number === null) return undefined;
  return `${slug}-${number}`;
}

/**
 * The tasks a document references, managed the way task relations are: the
 * reader adds one from a picker and removes one from the row's context menu.
 *
 * A reference is a row, not a phrase in the body — writing about a task and
 * referencing it are separate acts, so neither editing the text nor pasting a
 * link changes what appears here.
 */
export default function DocumentTaskReferences({
  documentId,
  projectId,
  workspaceId,
}: DocumentTaskReferencesProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(true);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const { data: tasks = [] } = useGetDocumentTasks(documentId);
  const { data: projectData } = useGetTasks(projectId);
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { canManageTasks } = useWorkspacePermission();
  const canEdit = canManageTasks();

  const linkTask = useLinkDocumentTask();
  const unlinkTask = useUnlinkDocumentTask();

  const linkedIds = useMemo(
    () => new Set(tasks.map((task) => task.id)),
    [tasks],
  );

  // The picker offers this project's tasks. The API accepts any task in the
  // workspace, so a reference made elsewhere still lists and unlinks here.
  const candidates = useMemo<LinkPickerItem[]>(() => {
    if (!projectData || !("columns" in projectData)) return [];
    const columns = projectData.columns as Array<{ tasks?: CandidateTask[] }>;

    return columns
      .flatMap((column) => column.tasks ?? [])
      .filter((task) => !linkedIds.has(task.id))
      .map((task) => {
        const key = issueKey(project?.slug, task.number);
        return {
          id: task.id,
          value: `${key ?? ""} ${task.title}`,
          label: task.title,
          hint: key,
          icon: getColumnIcon(task.status),
        };
      });
  }, [projectData, project?.slug, linkedIds]);

  const openTask = (taskId: string, taskProjectId: string) => {
    void navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: { workspaceId, projectId: taskProjectId, taskId },
    });
  };

  const handleLink = (taskId: string) => {
    setIsPickerOpen(false);
    linkTask.mutate(
      { documentId, taskId },
      { onError: () => toast.error(t("documents:references.linkFailed")) },
    );
  };

  const handleUnlink = (taskId: string) => {
    unlinkTask.mutate(
      { documentId, taskId },
      { onError: () => toast.error(t("documents:references.unlinkFailed")) },
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
                <span>{t("documents:references.title")}</span>
              </button>
            </CollapsibleTrigger>
            {tasks.length > 0 && (
              <span className="text-muted-foreground text-xs">
                {tasks.length}
              </span>
            )}
          </div>
          {canEdit && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => setIsPickerOpen(true)}
              aria-label={t("documents:references.add")}
            >
              <Plus className="size-3.5" />
            </Button>
          )}
        </div>

        <CollapsibleContent>
          <div className="mt-0.5 flex flex-col">
            {tasks.map((task) => {
              const key = issueKey(task.projectSlug, task.number);
              return (
                <ContextMenu key={task.id}>
                  <ContextMenuTrigger asChild>
                    <div className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent/50">
                      <span className="shrink-0">
                        {getColumnIcon(task.status)}
                      </span>
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                        onClick={() => openTask(task.id, task.projectId)}
                      >
                        {key && (
                          <span className="shrink-0 font-mono text-muted-foreground text-xs">
                            {key}
                          </span>
                        )}
                        <span className="truncate text-foreground/90 text-sm">
                          {task.title}
                        </span>
                      </button>
                    </div>
                  </ContextMenuTrigger>

                  <ContextMenuContent className="w-40">
                    <ContextMenuItem
                      onClick={() => openTask(task.id, task.projectId)}
                    >
                      <span>{t("documents:references.openTask")}</span>
                    </ContextMenuItem>
                    {canEdit && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="text-destructive"
                          onClick={() => handleUnlink(task.id)}
                        >
                          <span>{t("documents:references.remove")}</span>
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>

          {tasks.length === 0 && (
            <p className="px-2 py-1 text-muted-foreground text-xs">
              {t("documents:references.empty")}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>

      <LinkPicker
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        items={candidates}
        groupLabel={t("documents:references.tasksInProject")}
        placeholder={t("documents:references.searchPlaceholder")}
        emptyText={t("documents:references.noTasksFound")}
        onSelect={handleLink}
      />
    </>
  );
}
