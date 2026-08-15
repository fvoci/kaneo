import { FileText, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

type DocumentEmptyStateProps = {
  onCreate: () => void;
  isCreating: boolean;
};

export default function DocumentEmptyState({
  onCreate,
  isCreating,
}: DocumentEmptyStateProps) {
  const { t } = useTranslation();

  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileText />
        </EmptyMedia>
        <EmptyTitle>{t("documents:empty.title")}</EmptyTitle>
        <EmptyDescription>{t("documents:empty.subtitle")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={onCreate} disabled={isCreating}>
          <Plus className="size-4" />
          {t("documents:new")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
