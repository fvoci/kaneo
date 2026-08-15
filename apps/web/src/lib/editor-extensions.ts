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
import { Marked, type marked } from "marked";
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

export type EditorSurface = "comment" | "document";

export type EditorExtensionOptions = {
  readOnly?: boolean;
  placeholder?: string;
  getHighlighter?: () => Highlighter | null;
  getMentionMembers?: () => MentionMember[];
  surface?: EditorSurface;
};

/**
 * Everything a surface is allowed to differ by. Anything not listed here is
 * shared, and deliberately so: the extension set decides which Markdown
 * survives a parse/serialize round trip, so two hand-maintained lists would
 * drift and silently change what gets persisted.
 *
 * `headingLevels`: wiki documents are long-form and allow the full range;
 * comments stop at h3.
 *
 * `canUpload`: uploads belong to a later phase for documents, and a node that
 * cannot be created is one less thing that can appear in stored Markdown.
 * EmbedBlock is not in this group — the paste handler offers an embed for video
 * URLs on both surfaces, and dropping the node would leave that choice silently
 * doing nothing.
 *
 * MermaidBlock and BlockMath are not surface-specific and must never become so.
 * Markdown tokenizers register globally, so once any editor carrying BlockMath
 * exists, every later editor parses `$$...$$` into a blockMath node — and a
 * surface whose schema lacks that node drops it, deleting the text. Registering
 * it on one surface only meant a comment written after a document was opened
 * lost its formula. MermaidBlock defines no node at all; it draws a preview
 * beside a fenced code block, so leaving it out only meant a stored diagram
 * never rendered.
 */
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

const SURFACES = {
  comment: {
    headingLevels: [1, 2, 3],
    canUpload: true,
    mermaidErrorKey: "activity:comment.editor.mermaid.renderFailed",
  },
  document: {
    headingLevels: [1, 2, 3, 4, 5, 6],
    canUpload: false,
    mermaidErrorKey: "documents:mermaid.renderFailed",
  },
} satisfies Record<
  EditorSurface,
  { headingLevels: HeadingLevel[]; canUpload: boolean; mermaidErrorKey: string }
>;

/**
 * The single source of truth for the editor schema. Every surface that stores
 * Markdown must build its editor from here.
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
  surface = "comment",
}: EditorExtensionOptions = {}): AnyExtension[] {
  const { headingLevels, canUpload, mermaidErrorKey } = SURFACES[surface];

  return [
    StarterKit.configure({
      heading: { levels: headingLevels },
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
      // Every editor parses against its own marked instance. Without this
      // `MarkdownManager` falls back to the module-level singleton that
      // `marked` exports, and each editor registers its tokenizers on that one
      // with no way to unregister: constructing a single editor that carries
      // BlockMath taught every other editor in the page to parse `$$...$$`
      // into a node their schema did not have, and parsing a node you cannot
      // hold means dropping it — the formula was deleted on the next save.
      //
      // Isolation belongs here rather than at each call site, because a call
      // site that forgets it silently goes back to sharing the singleton.
      //
      // The option is typed as the `marked` module rather than as a `Marked`,
      // so it demands a `getDefaults` that instances do not carry.
      // `MarkdownManager` never calls it — it uses `use`, `lexer`, `Lexer`,
      // `defaults` and `setOptions`, all of which an instance has — so the
      // stricter type is describing the default value, not the contract.
      marked: new Marked() as unknown as typeof marked,
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
      errorKey: mermaidErrorKey,
    }),
    BlockMath,
    EmbedBlock,
    // Both upload nodes stay at the position they were declared at before the
    // two surfaces shared a builder: extension order decides ProseMirror's
    // schema order, and schema order breaks ties between parse rules.
    ...(canUpload ? [AttachmentCard] : []),
    KaneoIssueLink,
    KaneoMention,
    MentionSuggestion.configure({
      getMembers: getMentionMembers,
    }),
    TaskList,
    ...(canUpload
      ? [
          Image.configure({
            HTMLAttributes: {
              class: "kaneo-editor-image",
              loading: "lazy",
            },
          }),
        ]
      : []),
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

export const createDocumentExtensions = (
  options: EditorExtensionOptions = {},
): AnyExtension[] =>
  createEditorExtensions({ ...options, surface: "document" });
