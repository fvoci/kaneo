import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

type DocumentConflictBannerProps = {
  currentVersion: number;
  myVersion: number;
  onReload: () => void;
};

/**
 * Shown instead of silently refetching. The draft in the editor is the user's
 * only copy of their edits, so the server version replaces it only when they
 * ask for it.
 */
export default function DocumentConflictBanner({
  currentVersion,
  myVersion,
  onReload,
}: DocumentConflictBannerProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2 border-amber-500/30 border-b bg-amber-500/10 px-4 py-2 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <span className="min-w-0 flex-1">
        {t("documents:conflict.message", { currentVersion, myVersion })}
      </span>
      <Button size="xs" variant="outline" onClick={onReload}>
        {t("documents:conflict.reload")}
      </Button>
    </div>
  );
}
