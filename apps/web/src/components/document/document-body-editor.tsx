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
    />
  );
}
