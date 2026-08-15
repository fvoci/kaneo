import type { AnyExtension } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
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

const roundTrip = (markdown: string, times = 1) =>
  roundTripWith(createEditorExtensions(), markdown, times);

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

  it("keeps issue links with their task id and issue key", () => {
    // Cross-references are derived from `task-id`, so losing it here would
    // quietly unlink every document that mentions a task.
    const input =
      '<kaneo-issue-link url="https://kaneo.test/dashboard/workspace/w/project/p/task/t1" issue-key="KAN-12" task-id="t1" />';
    const once = expectStable(input);

    expect(once).toContain(
      'url="https://kaneo.test/dashboard/workspace/w/project/p/task/t1"',
    );
    expect(once).toContain('issue-key="KAN-12"');
    expect(once).toContain('task-id="t1"');
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

  const names = (extensions: AnyExtension[]) =>
    new Set(extensions.map((extension) => extension.name));

  // Round-tripping a mermaid fence proves nothing about this: the fence is an
  // ordinary code block and survives with or without the extension. What the
  // extension decides is whether the diagram is ever drawn, so assert its
  // presence directly.
  it("draws mermaid previews on both surfaces", () => {
    expect(names(createEditorExtensions())).toContain("mermaidBlock");
    expect(names(createDocumentExtensions())).toContain("mermaidBlock");
  });

  // Uploads have no home on the document surface yet, so the nodes an upload
  // would create stay out of the schema.
  it("keeps upload-only nodes off the document surface", () => {
    const documentNames = names(createDocumentExtensions());
    expect(documentNames).not.toContain("image");
    expect(documentNames).not.toContain("attachmentCard");
  });

  // The two surfaces share one builder, so a surface option is the only way
  // they can diverge. Pin the entire divergence: anything that decides how
  // Markdown parses — blockMath and the mermaid fence above all — must never
  // become surface-specific, because a node missing from one schema is text
  // deleted on that surface.
  it("differs between the surfaces only by the upload nodes", () => {
    const comment = names(createEditorExtensions());
    const document = names(createDocumentExtensions());

    expect([...comment].filter((name) => !document.has(name)).sort()).toEqual([
      "attachmentCard",
      "image",
    ]);
    expect([...document].filter((name) => !comment.has(name))).toEqual([]);
  });

  // `MarkdownManager` falls back to the singleton `marked` exports, and
  // tokenizers registered on it cannot be removed. One editor carrying
  // BlockMath therefore used to teach every other editor on the page to parse
  // `$$...$$` into a node their schema did not have, and a node you cannot
  // hold is dropped — which deleted the formula from whatever was saved next.
  //
  // The editor below is deliberately built by hand, deliberately lacks
  // BlockMath, and deliberately leaves `marked` unset so it parses against the
  // shared singleton — exactly the shape every surface has before someone
  // routes it through this file. If it still round-trips a formula after our
  // editors have been constructed, then nothing we build reaches across into
  // anyone else's parser.
  it("does not teach a foreign editor to parse maths it cannot hold", () => {
    const foreign = () => [
      StarterKit.configure({ trailingNode: false }),
      Markdown.configure({ markedOptions: { breaks: true, gfm: true } }),
    ];
    const formula = "$$\nE=mc^2\n$$";

    const before = roundTripWith(foreign(), formula, 1);
    expect(before).toContain("E=mc^2");

    roundTripWith(createDocumentExtensions(), formula, 1);
    roundTripWith(createEditorExtensions(), formula, 1);

    expect(roundTripWith(foreign(), formula, 4)).toBe(before);
  });

  // The three surfaces this app actually renders. Whatever else they differ
  // by, none of them may differ by what Markdown means.
  const SURFACES = {
    comment: () => createEditorExtensions(),
    document: () => createDocumentExtensions(),
    task: () => createEditorExtensions({ mentions: false }),
  };

  it.each(Object.keys(SURFACES))(
    "gives the %s surface every markdown syntax extension",
    (surface) => {
      const present = names(SURFACES[surface as keyof typeof SURFACES]());
      for (const required of ["blockMath", "mermaidBlock", "markdown"]) {
        expect(present, `${surface} is missing ${required}`).toContain(
          required,
        );
      }
    },
  );

  it.each(Object.keys(SURFACES))("renders a formula on the %s surface", (s) => {
    const html = htmlFor(
      SURFACES[s as keyof typeof SURFACES](),
      "$$\n\\frac{a}{b}\n$$",
    );
    expect(html).toContain('data-type="block-math"');
  });

  // `mentions: false` is the only thing the task surface asks for, so it had
  // better be the only thing it loses. Descriptions gaining an `@` picker would
  // be a feature nobody asked for; losing anything else would be the bug.
  it("drops only the mention extensions when mentions are off", () => {
    const withMentions = names(createEditorExtensions());
    const without = names(createEditorExtensions({ mentions: false }));

    expect(
      [...withMentions].filter((name) => !without.has(name)).sort(),
    ).toEqual(["kaneoMention", "kaneoMentionSuggestion"]);
    expect([...without].filter((name) => !withMentions.has(name))).toEqual([]);
  });

  // Extension order becomes ProseMirror's schema order, which breaks ties
  // between parse rules. Sharing a builder must not quietly reorder either set.
  it("registers the shared extensions in the same order on both surfaces", () => {
    const commentShared = createEditorExtensions()
      .map((extension) => extension.name)
      .filter((name) => name !== "image" && name !== "attachmentCard");

    expect(commentShared).toEqual(
      createDocumentExtensions().map((extension) => extension.name),
    );
  });

  it("registers block maths on both surfaces and inline maths on neither", () => {
    for (const set of [createEditorExtensions(), createDocumentExtensions()]) {
      expect(names(set)).toContain("blockMath");
      expect(names(set)).not.toContain("inlineMath");
    }
  });

  it("keeps a comment's formula after a document has been opened", () => {
    // Markdown tokenizers register globally, so the moment an editor carrying
    // blockMath exists, every later editor parses `$$...$$` into that node. A
    // surface whose schema lacked it dropped the node and the text vanished —
    // opening a document and then editing a comment deleted the formula. Both
    // surfaces carry the node so there is nothing to drop.
    roundTripWith(createDocumentExtensions(), "$$\nE=mc^2\n$$", 1);

    const inComment = roundTripWith(
      createEditorExtensions(),
      "$$\nE=mc^2\n$$",
      4,
    );
    expect(inComment).toBe("$$\nE=mc^2\n$$");
  });

  it("keeps ordinary comments untouched once maths is registered", () => {
    roundTripWith(createDocumentExtensions(), "$$\nE=mc^2\n$$", 1);

    expect(roundTripWith(createEditorExtensions(), "평범한 코멘트", 4)).toBe(
      "평범한 코멘트",
    );
    expect(
      roundTripWith(createEditorExtensions(), "가격은 $100, 할인가 $80", 4),
    ).toBe("가격은 $100, 할인가 $80");
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

  it("keeps a mermaid fence exactly as written", () => {
    // Mermaid is a decoration over a fenced code block, not a node of its own,
    // so what is stored is whatever the code block serializes. A document that
    // holds a diagram must reopen with the same source, or the diagram is a
    // different diagram.
    const md = "```mermaid\ngraph TD;\n  A[시작] --> B[끝];\n```";
    expectDocLossless(md);
  });

  it("keeps the arrows and labels a diagram is made of", () => {
    // The characters most at risk of being escaped on the way out.
    const md =
      "```mermaid\nsequenceDiagram\n  A->>B: 요청 <있음>\n  B-->>A: 응답 & 종료\n```";
    const once = docTrip(md);
    expect(once).toContain("A->>B: 요청 <있음>");
    expect(once).toContain("B-->>A: 응답 & 종료");
    expect(docTrip(md, 4)).toBe(once);
  });

  it("does not turn a mermaid fence into anything but a code block", () => {
    // The preview is a widget decoration; it must never become stored content.
    const html = htmlFor(
      createDocumentExtensions(),
      "```mermaid\ngraph TD;\n  A --> B;\n```",
    );
    expect(html).toContain("<pre");
    expect(html).toContain("graph TD;");
    expect(html).not.toContain("kaneo-mermaid-preview");
  });

  it("keeps a mermaid fence on the comment surface too", () => {
    // Both surfaces carry MermaidBlock, so a diagram pasted into a comment
    // stores the same text a document would.
    const md = "```mermaid\ngraph TD;\n  A --> B;\n```";
    expect(roundTripWith(createEditorExtensions(), md, 4)).toBe(md.trim());
  });

  it("keeps block formulas through repeated saves", () => {
    expectDocLossless("$$\n\\frac{a}{b}\n$$");
    expectDocLossless("$$\nE=mc^2\n$$");
    expectDocLossless("$$\n\\alpha_1^2 + \\beta^{n-1}\n$$");
  });

  it("renders a block formula as maths, not as text", () => {
    const html = htmlFor(createDocumentExtensions(), "$$\n\\frac{a}{b}\n$$");
    expect(html).toContain('data-type="block-math"');
  });

  it("leaves dollars in prose alone", () => {
    // The reason maths is block-only. The inline `$...$` tokenizer reads any
    // two dollars on a line as a formula, so a price list or a shell variable
    // would parse as maths and come back without the space between them.
    // Block `$$` cannot reach into a sentence, so these stay text.
    expectDocLossless("가격은 $100, 할인가 $80");
    expectDocLossless("환경변수 `$PATH` 를 확인");
    expectDocLossless("표본 크기 $n$ 개");
    expectDocLossless("$50 에서 $70 으로 올랐다");
    expectDocLossless("쉘에서 $HOME 과 $USER 를 쓴다");
  });

  it("does not parse prose dollars into a maths node", () => {
    // Stronger than the round trip: text can survive a trip and still have
    // become the wrong kind of node on the way.
    const html = htmlFor(createDocumentExtensions(), "가격은 $100, 할인가 $80");
    expect(html).not.toContain("math");
    expect(html).toContain("$100");
    expect(html).toContain("$80");
  });

  it("keeps blockquotes, lists and checklists", () => {
    expectDocLossless("> 인용문");
    expectDocLossless("- 첫째\n- 둘째\n  - 하위");
    expectDocLossless("1. 하나\n2. 둘");
    expectDocLossless("- [ ] 할 일\n- [x] 완료");
  });

  it("keeps fenced code blocks", () => {
    expectDocLossless("```python\nprint('측정')\n```");
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
    // The document surface is where cross-references are synced from.
    expect(once).toContain('task-id="t1"');
    expect(once).toContain('issue-key="KAN-12"');
    expect(docTrip(issueLink, 4)).toBe(once);
  });

  it("keeps the task id through four save cycles", () => {
    const issueLink =
      '<kaneo-issue-link url="https://kaneo.test/dashboard/workspace/w/project/p/task/abc123" issue-key="KAN-7" task-id="abc123" />';
    expect(docTrip(issueLink, 4)).toContain('task-id="abc123"');
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
