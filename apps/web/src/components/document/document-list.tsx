import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/cn";
import { documentKey } from "@/lib/document-key";
import type { DocumentSummary } from "@/types/document";

type DocumentListProps = {
  documents: DocumentSummary[];
  selectedId: string | undefined;
  projectSlug: string | undefined;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onDelete: (document: DocumentSummary) => void;
};

function formatUpdatedAt(value: string, locale: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export default function DocumentList({
  documents,
  selectedId,
  projectSlug,
  canDelete,
  onSelect,
  onDelete,
}: DocumentListProps) {
  const { t, i18n } = useTranslation();

  return (
    <ul className="flex flex-col gap-0.5 p-2">
      {documents.map((document) => {
        const isSelected = document.id === selectedId;
        const key = documentKey(projectSlug, document.number);
        return (
          <ContextMenu key={document.id}>
            <ContextMenuTrigger asChild>
              <li>
                <button
                  type="button"
                  onClick={() => onSelect(document.id)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    {key && (
                      <span className="shrink-0 font-mono text-muted-foreground text-xs">
                        {key}
                      </span>
                    )}
                    <span className="truncate text-sm">
                      {document.title || t("documents:untitled")}
                    </span>
                  </span>
                  <span className="truncate pl-5 text-muted-foreground text-xs">
                    {t("documents:updatedAt", {
                      when: formatUpdatedAt(document.updatedAt, i18n.language),
                    })}
                  </span>
                </button>
              </li>
            </ContextMenuTrigger>

            <ContextMenuContent className="w-40">
              <ContextMenuItem onClick={() => onSelect(document.id)}>
                <span>{t("documents:open")}</span>
              </ContextMenuItem>
              {canDelete && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-destructive"
                    onClick={(event) => {
                      // Let the menu finish closing before the dialog opens, or
                      // the two fight over focus. Task cards do the same.
                      event.preventDefault();
                      setTimeout(() => onDelete(document), 0);
                    }}
                  >
                    <span>{t("documents:delete")}</span>
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </ul>
  );
}
