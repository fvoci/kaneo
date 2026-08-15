import type { AnyExtension } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  createDocumentExtensions,
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
function roundTripWith(
  extensions: AnyExtension[],
  markdown: string,
  times: number,
) {
  const editor = new Editor({ extensions });
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

function htmlFor(extensions: AnyExtension[], markdown: string) {
  const editor = new Editor({ extensions });
  editor.commands.setContent(markdown, {
    emitUpdate: false,
    contentType: "markdown",
  });
  const html = editor.getHTML();
  editor.destroy();
  return html;
}

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

describe("extension sets are well formed", () => {
  const duplicates = (extensions: AnyExtension[]) => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const extension of extensions) {
      const name = extension.name;
      if (seen.has(name)) dupes.push(name);
      seen.add(name);
    }
    return dupes;
  };

  // A duplicate name makes Tiptap warn and lets the later registration silently
  // replace the earlier one's configuration. StarterKit already bundles Link,
  // Underline and the list extensions, so they must be configured through it.
  it("registers no extension name twice on the comment surface", () => {
    expect(duplicates(createEditorExtensions())).toEqual([]);
  });

  it("registers no extension name twice on the document surface", () => {
    expect(duplicates(createDocumentExtensions())).toEqual([]);
  });

  it("keeps link configured on both surfaces", () => {
    for (const html of [
      htmlFor(createEditorExtensions(), "[a](https://example.com)"),
      htmlFor(createDocumentExtensions(), "[a](https://example.com)"),
    ]) {
      expect(html).toContain('href="https://example.com"');
    }
  });
});

describe("document surface", () => {
  const docTrip = (markdown: string, times = 1) =>
    roundTripWith(createDocumentExtensions(), markdown, times);

  const expectDocLossless = (markdown: string) => {
    expect(docTrip(markdown, 1)).toBe(markdown.trim());
    // Four passes stands in for a document saved and reopened repeatedly.
    expect(docTrip(markdown, 4)).toBe(markdown.trim());
  };

  it("renders every heading level, unlike the comment surface", () => {
    const md = "# 1\n\n## 2\n\n### 3\n\n#### 4\n\n##### 5\n\n###### 6";
    expectDocLossless(md);
    expect(htmlFor(createDocumentExtensions(), md)).toBe(
      "<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6>",
    );
  });

  it("renders a Korean h4 as h4", () => {
    expectDocLossless("#### 실험 방법");
    expect(htmlFor(createDocumentExtensions(), "#### 실험 방법")).toBe(
      "<h4>실험 방법</h4>",
    );
  });

  it("keeps table column alignment markers", () => {
    const once = docTrip(
      "| 왼쪽 | 가운데 | 오른쪽 |\n|:---|:---:|---:|\n| 1 | 2 | 3 |",
    );

    // Cell padding is rewritten, but the alignment row survives verbatim.
    expect(once).toContain("| :--- | :---: | ---: |");
    expect(once).toContain("왼쪽");
    expect(
      docTrip(
        "| 왼쪽 | 가운데 | 오른쪽 |\n|:---|:---:|---:|\n| 1 | 2 | 3 |",
        4,
      ),
    ).toBe(once);

    const html = htmlFor(
      createDocumentExtensions(),
      "| 왼쪽 | 가운데 | 오른쪽 |\n|:---|:---:|---:|\n| 1 | 2 | 3 |",
    );
    expect(html).toContain("text-align: left");
    expect(html).toContain("text-align: center");
    expect(html).toContain("text-align: right");
  });

  it("keeps Korean table cells", () => {
    const md = "| 항목 | 값 |\n| --- | --- |\n| 온도 | 4℃ |";
    const once = docTrip(md);
    expect(once).toContain("항목");
    expect(once).toContain("4℃");
    expect(docTrip(md, 4)).toBe(once);
    expect(htmlFor(createDocumentExtensions(), md)).toContain("<table");
  });

  it("keeps blockquotes, lists and checklists", () => {
    expectDocLossless("> 인용문");
    expectDocLossless("- 첫째\n- 둘째\n  - 하위");
    expectDocLossless("1. 하나\n2. 둘");
    expectDocLossless("- [ ] 할 일\n- [x] 완료");
  });

  it("keeps fenced code blocks including a mermaid fence", () => {
    expectDocLossless("```python\nprint('측정')\n```");
    // MermaidBlock is not loaded here, so a mermaid fence stays a code block
    // rather than a diagram — the source is preserved either way.
    expectDocLossless("```mermaid\ngraph TD;\nA-->B;\n```");
  });

  it("keeps mention and issue-link nodes", () => {
    expectDocLossless('<kaneo-mention id="u1" label="김"></kaneo-mention>');
    const issueLink =
      '<kaneo-issue-link url="https://kaneo.test/dashboard/workspace/w/project/p/task/t1" issue-key="KAN-12" task-id="t1" />';
    const once = docTrip(issueLink);
    expect(once).toContain("kaneo-issue-link");
    expect(once).toContain(
      'url="https://kaneo.test/dashboard/workspace/w/project/p/task/t1"',
    );
    expect(docTrip(issueLink, 4)).toBe(once);
  });

  it("drops image URLs because the image node is not loaded", () => {
    // Excluding Image keeps uploads out of documents, but it also means plain
    // Markdown images lose their src and survive only as their alt text.
    expect(docTrip("![대체텍스트](https://example.com/a.png)")).toBe(
      "대체텍스트",
    );
  });

  it("survives four passes over a mixed Korean document", () => {
    const md = [
      "# 실험 프로토콜",
      "",
      "#### 4단계 세부 항목",
      "",
      "| 항목 | 값 | 비고 |",
      "|:---|:---:|---:|",
      "| 온도 | 4℃ | 유지 |",
      "",
      "- [x] 시약 준비",
      "- [ ] 측정",
      "",
      '> 담당: <kaneo-mention id="u1" label="김"></kaneo-mention>',
      "",
      "```python",
      "print('측정 시작')",
      "```",
    ].join("\n");

    const once = docTrip(md, 1);
    expect(docTrip(md, 3)).toBe(once);
    expect(docTrip(md, 4)).toBe(once);
    expect(once).toContain("#### 4단계 세부 항목");
    expect(once).toContain("| :--- | :---: | ---: |");
    expect(once).toContain("4℃");
    expect(once).toContain("kaneo-mention");
  });
});

describe("comment surface is unchanged by the document preset", () => {
  it("still limits headings to h1-h3", () => {
    expect(htmlFor(createEditorExtensions(), "#### Four")).toBe(
      "<h1>Four</h1>",
    );
  });

  it("still renders tables", () => {
    // Comments have always had tables; the document preset does not remove them.
    expect(
      htmlFor(createEditorExtensions(), "| a | b |\n| --- | --- |\n| 1 | 2 |"),
    ).toContain("<table");
  });

  it("still keeps markdown images", () => {
    expect(roundTrip("![alt](https://example.com/a.png)")).toBe(
      "![alt](https://example.com/a.png)",
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
