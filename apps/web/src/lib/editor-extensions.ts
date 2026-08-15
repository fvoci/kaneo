import type { AnyExtension } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { bundledLanguages, type Highlighter } from "shiki";
import { AttachmentCard } from "@/components/task/extensions/attachment-card";
import { EmbedBlock } from "@/components/task/extensions/embed-block";
import { KaneoIssueLink } from "@/components/task/extensions/kaneo-issue-link";
import { KaneoMention } from "@/components/task/extensions/kaneo-mention";
import type { MentionMember } from "@/components/task/extensions/mention-list";
import { MentionSuggestion } from "@/components/task/extensions/mention-suggestion";
import { MermaidBlock } from "@/components/task/extensions/mermaid-block";
import { ShikiCodeBlock } from "@/components/task/extensions/shiki-code-block";
import { TaskItemWithCheckbox } from "@/components/task/extensions/task-item-with-checkbox";

const SHIKI_LANGUAGE_ALIASES: Record<string, string> = {
  plaintext: "text",
};

const AVAILABLE_SHIKI_LANGUAGES = new Set(Object.keys(bundledLanguages));

export function toShikiLanguage(language: string) {
  const normalized = language.toLowerCase();
  const alias = SHIKI_LANGUAGE_ALIASES[normalized];
  if (alias) return alias;
  if (AVAILABLE_SHIKI_LANGUAGES.has(normalized)) return normalized;
  return "text";
}

/**
 * Applied on both read and write so a value that round-trips through the
 * editor compares equal to what was stored.
 */
export function normalizeMarkdown(markdown: string) {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n{2,}$/g, "\n");
}

export type EditorExtensionOptions = {
  readOnly?: boolean;
  placeholder?: string;
  getHighlighter?: () => Highlighter | null;
  getMentionMembers?: () => MentionMember[];
};

/**
 * The single source of truth for the editor schema. Every surface that stores
 * Markdown must build its editor from here: the set of extensions decides
 * which Markdown survives a parse/serialize round trip, so a second, drifting
 * list would silently change what gets persisted.
 */
export function createEditorExtensions({
  readOnly = false,
  placeholder = "",
  getHighlighter = () => null,
  getMentionMembers = () => [],
}: EditorExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      trailingNode: false,
      codeBlock: {
        HTMLAttributes: { class: "kaneo-tiptap-codeblock" },
      },
    }),
    Link.configure({
      autolink: true,
      defaultProtocol: "https",
      linkOnPaste: true,
      openOnClick: readOnly,
    }),
    Markdown.configure({
      markedOptions: {
        breaks: true,
        gfm: true,
      },
    }),
    ShikiCodeBlock.configure({
      highlighter: getHighlighter,
      resolveLanguage: toShikiLanguage,
      themeDark: "github-dark",
      themeLight: "github-light",
    }),
    MermaidBlock.configure({
      errorKey: "activity:comment.editor.mermaid.renderFailed",
    }),
    EmbedBlock,
    AttachmentCard,
    KaneoIssueLink,
    KaneoMention,
    MentionSuggestion.configure({
      getMembers: getMentionMembers,
    }),
    TaskList,
    Image.configure({
      HTMLAttributes: {
        class: "kaneo-editor-image",
        loading: "lazy",
      },
    }),
    TaskItemWithCheckbox.configure({
      nested: true,
    }),
    Placeholder.configure({
      placeholder,
    }),
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
  ];
}
