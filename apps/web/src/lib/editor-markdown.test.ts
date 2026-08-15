import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  createEditorExtensions,
  normalizeMarkdown,
} from "@/lib/editor-extensions";

/**
 * Documents are stored as Markdown, so every open/save cycle parses and
 * re-serializes the body. These tests pin what survives that trip.
 *
 * Two properties matter and they are not the same:
 *  - lossless: one trip returns the input unchanged.
 *  - stable:   repeated trips stop changing the text. A format that is lossy
 *              but stable degrades once; a format that is unstable keeps
 *              rewriting the document on every edit, which is far worse.
 *
 * Cases that are knowingly lossy are asserted with their actual output rather
 * than skipped, so a future extension that fixes them fails here and gets
 * noticed.
 */
function roundTrip(markdown: string, times = 1) {
  const editor = new Editor({ extensions: createEditorExtensions() });
  let current = normalizeMarkdown(markdown);
  for (let i = 0; i < times; i += 1) {
    editor.commands.setContent(current, {
      emitUpdate: false,
      contentType: "markdown",
    });
    current = normalizeMarkdown(editor.getMarkdown());
  }
  editor.destroy();
  return current.trim();
}

function expectLossless(markdown: string) {
  const once = roundTrip(markdown, 1);
  expect(once).toBe(markdown.trim());
  // Four passes stands in for a document edited and saved repeatedly.
  expect(roundTrip(markdown, 4)).toBe(markdown.trim());
}

function expectStable(markdown: string) {
  const once = roundTrip(markdown, 1);
  expect(roundTrip(markdown, 2)).toBe(once);
  expect(roundTrip(markdown, 4)).toBe(once);
  return once;
}

describe("markdown round-trip: preserved", () => {
  it("keeps headings the editor supports", () => {
    expectLossless("# One\n\n## Two\n\n### Three");
  });

  it("keeps Korean text with inline emphasis", () => {
    expectLossless("# 연구 노트\n\n첫 문단입니다. **굵게** 그리고 *기울임*.");
  });

  it("keeps Korean nested lists", () => {
    expectLossless("- 첫째 항목\n- 둘째 항목\n  - 하위 항목");
  });

  it("keeps bullet and ordered lists", () => {
    expectLossless("- a\n- b\n  - nested");
    expectLossless("1. first\n2. second");
  });

  it("keeps task list checkboxes", () => {
    expectLossless("- [ ] todo\n- [x] done");
  });

  it("keeps fenced code blocks with a language", () => {
    expectLossless("```ts\nconst x: number = 1;\n```");
  });

  it("keeps links, blockquotes and rules", () => {
    expectLossless("[link](https://example.com)");
    expectLossless("> quoted");
    expectLossless("---");
  });

  it("keeps mention nodes with their id and label", () => {
    expectLossless('<kaneo-mention id="u1" label="Kim"></kaneo-mention>');
  });

  it("leaves math notation as literal text", () => {
    // Not rendered as math, but the characters survive.
    expectLossless("$E = mc^2$");
  });

  it("keeps a realistic Korean document with mixed structure", () => {
    expectLossless(
      [
        "# 실험 프로토콜",
        "",
        "## 준비물",
        "",
        "- 시약 A",
        "- 시약 B",
        "",
        "## 절차",
        "",
        "1. 시약을 섞는다",
        "2. 30분 대기",
        "",
        "> 주의: 온도를 4℃로 유지할 것",
        "",
        "```python",
        'print("측정 시작")',
        "```",
      ].join("\n"),
    );
  });
});

describe("markdown round-trip: known losses", () => {
  it("renders h4-h6 as h1 while keeping the markdown text", () => {
    // The heading node keeps level 4, but StarterKit is configured for levels
    // 1-3 only, so the DOM falls back to <h1>: the file is fine, the page is
    // not. Raising the configured levels is what fixes this.
    expectLossless("#### Four");

    const editor = new Editor({ extensions: createEditorExtensions() });
    editor.commands.setContent("#### Four", {
      emitUpdate: false,
      contentType: "markdown",
    });
    expect(editor.getHTML()).toBe("<h1>Four</h1>");
    editor.destroy();
  });

  it("drops issue-key and task-id from issue links", () => {
    // The attributes render as kebab-case but are declared camelCase without a
    // parseHTML mapping, so they never survive a parse. `url` does survive,
    // which is why the chip still resolves the task.
    const input =
      '<kaneo-issue-link url="https://kaneo.test/dashboard/workspace/w/project/p/task/t1" issue-key="KAN-12" task-id="t1" />';
    const once = expectStable(input);

    expect(once).toContain(
      'url="https://kaneo.test/dashboard/workspace/w/project/p/task/t1"',
    );
    expect(once).toContain('issue-key=""');
    expect(once).toContain('task-id=""');
  });

  it("turns single newlines into hard breaks", () => {
    // `breaks: true` is configured, so a soft wrap becomes a literal break.
    expect(expectStable("line one\nline two")).toBe("line one  \nline two");
  });

  it("mangles footnotes into inline links", () => {
    expect(expectStable("text[^1]\n\n[^1]: note")).toBe("text[^1](note)");
  });

  it("destroys YAML front matter", () => {
    expect(expectStable("---\ntitle: Doc\n---\n\n# Body")).toBe(
      "---\n\n## title: Doc\n\n# Body",
    );
  });

  it("adds a hard break inside definition lists", () => {
    expect(expectStable("Term\n: Definition")).toBe("Term  \n: Definition");
  });

  it("reformats table cell padding", () => {
    expect(expectStable("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |",
    );
  });
});

describe("markdown round-trip: stability", () => {
  it("converges after the first pass for every known case", () => {
    const inputs = [
      "# One\n\n## Two",
      "#### Four",
      "- 첫째\n- 둘째",
      "line one\nline two",
      "text[^1]\n\n[^1]: note",
      "---\ntitle: Doc\n---\n\n# Body",
      "Term\n: Definition",
      "| a | b |\n| --- | --- |\n| 1 | 2 |",
      '<kaneo-mention id="u1" label="Kim"></kaneo-mention>',
      '<kaneo-issue-link url="https://kaneo.test/task/t1" issue-key="K-1" task-id="t1" />',
    ];

    for (const input of inputs) {
      const once = roundTrip(input, 1);
      expect(roundTrip(input, 4), `unstable across edits: ${input}`).toBe(once);
    }
  });
});
