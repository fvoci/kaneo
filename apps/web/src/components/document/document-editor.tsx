import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Document } from "@/types/document";

type DocumentEditorProps = {
  document: Document;
  isSaving: boolean;
  isDeleting: boolean;
  onSave: (draft: { title: string; content: string; version: number }) => void;
  onDelete: () => void;
};

/**
 * Phase 1 uses a plain textarea: the body is stored as Markdown, so a
 * rich-text editor is an addition rather than a migration. Saving is explicit
 * so a version conflict surfaces at a moment the user can act on.
 */
export default function DocumentEditor({
  document,
  isSaving,
  isDeleting,
  onSave,
  onDelete,
}: DocumentEditorProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content ?? "");
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // Re-seed the draft when a save or a conflict-driven refetch replaces the
  // server copy. Switching documents is handled by the caller's `key`, which
  // remounts this component with fresh state.
  useEffect(() => {
    setTitle(document.title);
    setContent(document.content ?? "");
  }, [document.title, document.content]);

  const isDirty =
    title !== document.title || content !== (document.content ?? "");
  const canSave = title.trim().length > 0 && isDirty && !isSaving;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-border/80 border-b px-4 py-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("documents:titlePlaceholder")}
          className="h-8 border-0 bg-transparent px-0 font-medium text-base shadow-none focus-visible:ring-0"
        />
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() =>
            onSave({ title: title.trim(), content, version: document.version })
          }
        >
          {isSaving ? t("documents:saving") : t("documents:save")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isDeleting}
          onClick={() => setIsDeleteOpen(true)}
          aria-label={t("documents:delete")}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={t("documents:contentPlaceholder")}
          className="h-full border-0 bg-transparent shadow-none"
          unstyled
        />
      </div>

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
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
                <Button variant="destructive" size="sm" onClick={onDelete} />
              }
            >
              {t("documents:delete")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
