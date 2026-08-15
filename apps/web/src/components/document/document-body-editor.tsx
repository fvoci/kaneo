import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { createDocumentExtensions } from "@/lib/editor-extensions";

type DocumentBodyEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

/**
 * The document surface's editor. It reuses CommentEditor for all of the
 * toolbar, slash menu and table UI, and only substitutes the extension set —
 * which is what decides the heading range and which nodes a document may
 * contain. Document-only affordances (cross-reference insertion, and so on)
 * belong here rather than in the shared editor.
 *
 * No `taskId` or `ensureTaskId` is passed, which is what keeps image and file
 * uploads switched off until attachments land.
 */
export default function DocumentBodyEditor({
  value,
  onChange,
  placeholder,
}: DocumentBodyEditorProps) {
  const { t } = useTranslation();

  return (
    <CommentEditor
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? t("documents:contentPlaceholder")}
      buildExtensions={createDocumentExtensions}
      showQuickAttachButton={false}
      // The document body scrolls with the page, so the slash menu is
      // positioned against the viewport instead of the editor shell: an
      // absolutely positioned menu gets clipped by the scroll container that
      // wraps this editor.
      slashMenuPosition="fixed"
      // Drop the comment box's fixed height so a document grows with its
      // content rather than becoming a small scrollable panel.
      className="h-full [&_.kaneo-comment-editor-content_.ProseMirror]:min-h-[24rem] [&_.kaneo-comment-editor-content_.ProseMirror]:max-h-none [&_.kaneo-comment-editor-content_.ProseMirror]:overflow-visible [&_.kaneo-comment-editor-content_.ProseMirror]:px-0 [&_.kaneo-comment-editor-content_.ProseMirror]:pt-1 [&_.kaneo-comment-editor-content_.ProseMirror]:pb-8"
    />
  );
}
