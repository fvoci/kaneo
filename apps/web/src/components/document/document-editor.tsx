import { Code2, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import DocumentBodyEditor from "@/components/document/document-body-editor";
import DocumentConflictBanner from "@/components/document/document-conflict-banner";
import DocumentTaskReferences from "@/components/document/document-task-references";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Document } from "@/types/document";

type DocumentEditorProps = {
  document: Document;
  isSaving: boolean;
  conflictVersion: number | null;
  workspaceId: string;
  onSave: (draft: { title: string; content: string; version: number }) => void;
  onReloadAfterConflict: () => void;
};

export default function DocumentEditor({
  document,
  isSaving,
  conflictVersion,
  workspaceId,
  onSave,
  onReloadAfterConflict,
}: DocumentEditorProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content ?? "");
  // Markdown that the rich editor cannot represent survives a save only if the
  // user edits it as source, so the raw view stays available.
  const [isSourceMode, setIsSourceMode] = useState(false);

  // Re-seed from the server copy after a save, or after the user explicitly
  // reloads following a conflict. A conflict alone must not touch the draft.
  useEffect(() => {
    setTitle(document.title);
    setContent(document.content ?? "");
  }, [document.title, document.content]);

  const isDirty =
    title !== document.title || content !== (document.content ?? "");
  const canSave = title.trim().length > 0 && isDirty && !isSaving;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {conflictVersion !== null ? (
        <DocumentConflictBanner
          currentVersion={conflictVersion}
          myVersion={document.version}
          onReload={onReloadAfterConflict}
        />
      ) : null}

      <div className="flex items-center gap-2 border-border/80 border-b px-4 py-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("documents:titlePlaceholder")}
          className="h-8 border-0 bg-transparent px-0 font-medium text-base shadow-none focus-visible:ring-0"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setIsSourceMode((mode) => !mode)}
          aria-label={
            isSourceMode
              ? t("documents:sourceMode.exit")
              : t("documents:sourceMode.enter")
          }
          title={
            isSourceMode
              ? t("documents:sourceMode.exit")
              : t("documents:sourceMode.enter")
          }
        >
          {isSourceMode ? (
            <Eye className="size-4" />
          ) : (
            <Code2 className="size-4" />
          )}
        </Button>
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() =>
            onSave({
              title: title.trim(),
              content,
              version: document.version,
            })
          }
        >
          {isSaving ? t("documents:saving") : t("documents:save")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isSourceMode ? (
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t("documents:contentPlaceholder")}
            className="min-h-[24rem] border-0 bg-transparent font-mono text-sm shadow-none"
            unstyled
          />
        ) : (
          <DocumentBodyEditor
            value={content}
            onChange={setContent}
            placeholder={t("documents:contentPlaceholder")}
          />
        )}

        {/* Below the body, mirroring where a task keeps its relations. */}
        <div className="mt-6 border-border/60 border-t pt-4">
          <DocumentTaskReferences
            documentId={document.id}
            projectId={document.projectId}
            workspaceId={workspaceId}
          />
        </div>
      </div>
    </div>
  );
}
