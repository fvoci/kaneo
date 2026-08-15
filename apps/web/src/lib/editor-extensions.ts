import type { AnyExtension } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { BlockMath } from "@tiptap/extension-mathematics";
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
 *
 * Maths is block-only, on purpose. The inline `$...$` tokenizer reads any two
 * dollars on a line as a formula, so "가격은 $100, 할인가 $80" parses as prose,
 * a formula, then prose — turning text nobody meant as maths into a rendered
 * equation and dropping a space on the way back out. Block `$$...$$` cannot
 * reach into a sentence, so a stray dollar stays a dollar. Inline maths can
 * follow if that tokenizer can be tightened; until then the cost would fall on
 * documents that never asked for maths at all.
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
      // StarterKit bundles Link; registering a second one collides on the mark
      // name and makes Tiptap warn about duplicate extensions.
      link: {
        autolink: true,
        defaultProtocol: "https",
        linkOnPaste: true,
        openOnClick: readOnly,
      },
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
    BlockMath,
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

/**
 * Wiki documents are long-form, so they allow the full heading range instead of
 * the h1-h3 that comments are limited to.
 *
 * Image and AttachmentCard are left out: uploads belong to a later phase, and a
 * node that cannot be created is one less thing that can appear in stored
 * Markdown. EmbedBlock stays because the paste handler offers an embed for
 * video URLs, and dropping the node would leave that choice silently doing
 * nothing.
 *
 * MermaidBlock is not in that group. It defines no node — it draws a preview
 * beside a fenced code block whose language is `mermaid` — so it adds nothing
 * to what gets stored. Leaving it out only meant a document could hold a
 * mermaid fence that never rendered.
 *
 * BlockMath is on both sets for the same reason. Markdown tokenizers register
 * globally, so once any editor carrying it exists, every later editor parses
 * `$$...$$` into a blockMath node — and a surface whose schema lacks that node
 * drops it, deleting the text. Registering it only here would mean a comment
 * written after a document was opened lost its formula.
 */
export function createDocumentExtensions({
  readOnly = false,
  placeholder = "",
  getHighlighter = () => null,
  getMentionMembers = () => [],
}: EditorExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      trailingNode: false,
      codeBlock: {
        HTMLAttributes: { class: "kaneo-tiptap-codeblock" },
      },
      link: {
        autolink: true,
        defaultProtocol: "https",
        linkOnPaste: true,
        openOnClick: readOnly,
      },
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
      errorKey: "documents:mermaid.renderFailed",
    }),
    BlockMath,
    EmbedBlock,
    KaneoIssueLink,
    KaneoMention,
    MentionSuggestion.configure({
      getMembers: getMentionMembers,
    }),
    TaskList,
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
