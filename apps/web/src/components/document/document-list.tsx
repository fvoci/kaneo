import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import {
  ancestorIds,
  buildDocumentTree,
  visibleTreeRows,
} from "@/lib/document-tree";
import type { DocumentSummary } from "@/types/document";

type DocumentListProps = {
  documents: DocumentSummary[];
  selectedId: string | undefined;
  projectSlug: string | undefined;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onDelete: (document: DocumentSummary) => void;
};

/**
 * Per level. The sidebar is 16rem and nesting stops at three levels, so the
 * deepest row still leaves most of the width to the title.
 */
const INDENT_PX = 16;

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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const roots = useMemo(() => buildDocumentTree(documents), [documents]);
  const rows = useMemo(
    () => visibleTreeRows(roots, collapsed),
    [roots, collapsed],
  );

  // Opening a nested document from anywhere else — a backlink, a URL — must not
  // leave it hidden inside a branch the reader had collapsed.
  useEffect(() => {
    const ancestors = ancestorIds(documents, selectedId);
    if (ancestors.length === 0) return;

    setCollapsed((current) => {
      if (!ancestors.some((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of ancestors) next.delete(id);
      return next;
    });
  }, [documents, selectedId]);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <ul className="flex flex-col gap-0.5 p-2">
      {rows.map(({ document, depth, children }) => {
        const isSelected = document.id === selectedId;
        const key = documentKey(projectSlug, document.number);
        const hasChildren = children.length > 0;
        const isCollapsed = collapsed.has(document.id);

        return (
          <ContextMenu key={document.id}>
            <ContextMenuTrigger asChild>
              <li style={{ paddingInlineStart: depth * INDENT_PX }}>
                <div
                  className={cn(
                    "flex w-full items-start gap-0.5 rounded-md transition-colors",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      // Its own control rather than part of the row: opening a
                      // branch and opening the document it belongs to are
                      // different intentions.
                      onClick={() => toggle(document.id)}
                      aria-expanded={!isCollapsed}
                      aria-label={
                        isCollapsed
                          ? t("documents:tree.expand")
                          : t("documents:tree.collapse")
                      }
                      className="mt-1.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                    </button>
                  ) : (
                    // Holds the column so titles line up whether or not a row
                    // can be opened.
                    <span className="mt-1.5 size-3.5 shrink-0 p-0.5" />
                  )}

                  <button
                    type="button"
                    onClick={() => onSelect(document.id)}
                    className="flex min-w-0 flex-1 flex-col gap-0.5 px-1 py-1.5 text-left"
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
                        when: formatUpdatedAt(
                          document.updatedAt,
                          i18n.language,
                        ),
                      })}
                    </span>
                  </button>
                </div>
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
