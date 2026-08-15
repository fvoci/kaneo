import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { DocumentSummary } from "@/types/document";

type DocumentListProps = {
  documents: DocumentSummary[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
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
  onSelect,
}: DocumentListProps) {
  const { t, i18n } = useTranslation();

  return (
    <ul className="flex flex-col gap-0.5 p-2">
      {documents.map((document) => {
        const isSelected = document.id === selectedId;
        return (
          <li key={document.id}>
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
        );
      })}
    </ul>
  );
}
