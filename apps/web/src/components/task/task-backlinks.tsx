import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useGetTaskDocuments } from "@/hooks/queries/document/use-get-task-documents";

type TaskBacklinksProps = {
  taskId: string;
  workspaceId: string;
};

/**
 * The reverse of the links a document body carries. Read-only: a document
 * claims a task by referencing it in its text, so there is nothing to add or
 * remove from this side.
 */
export default function TaskBacklinks({
  taskId,
  workspaceId,
}: TaskBacklinksProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(true);
  const { data: documents = [] } = useGetTaskDocuments(taskId);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
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

      <CollapsibleContent>
        <ul className="mt-1 flex flex-col gap-0.5">
          {documents.map((document) => (
            <li key={document.id}>
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
                <span className="truncate text-sm">
                  {document.title || t("documents:untitled")}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {documents.length === 0 && (
          <p className="px-2 py-1 text-muted-foreground text-xs">
            {t("documents:backlinks.empty")}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
