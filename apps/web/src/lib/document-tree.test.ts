import { describe, expect, it } from "vitest";
import {
  ancestorIds,
  buildDocumentTree,
  visibleTreeRows,
} from "@/lib/document-tree";
import type { DocumentSummary } from "@/types/document";

const doc = (
  id: string,
  parentId: string | null = null,
  position = 0,
): DocumentSummary =>
  ({
    id,
    projectId: "p1",
    parentId,
    position,
    number: 1,
    title: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as DocumentSummary;

const titles = (rows: { document: DocumentSummary }[]) =>
  rows.map((row) => row.document.id);

describe("buildDocumentTree", () => {
  it("nests children under the parent they name", () => {
    const roots = buildDocumentTree([
      doc("root"),
      doc("child", "root"),
      doc("grandchild", "child"),
    ]);

    expect(roots).toHaveLength(1);
    expect(titles(roots[0]?.children ?? [])).toEqual(["child"]);
    expect(titles(roots[0]?.children[0]?.children ?? [])).toEqual([
      "grandchild",
    ]);
  });

  it("numbers the depth from zero at the root", () => {
    const roots = buildDocumentTree([
      doc("root"),
      doc("child", "root"),
      doc("grandchild", "child"),
    ]);
    const rows = visibleTreeRows(roots, new Set());

    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2]);
  });

  // The list arrives sorted by position; re-sorting here would put the same
  // decision in two places.
  it("keeps siblings in the order they arrive", () => {
    const roots = buildDocumentTree([
      doc("first", null, 0),
      doc("second", null, 1),
      doc("a", "first", 0),
      doc("b", "first", 1),
    ]);

    expect(titles(roots)).toEqual(["first", "second"]);
    expect(titles(roots[0]?.children ?? [])).toEqual(["a", "b"]);
  });

  // The server's cascade means this should not happen. If it ever does, the
  // document still has to appear somewhere — dropping it would take a document
  // out of the list with nothing to show for it.
  it("shows a document whose parent is missing rather than losing it", () => {
    const roots = buildDocumentTree([doc("kept", "gone-from-the-list")]);

    expect(titles(roots)).toEqual(["kept"]);
    expect(roots[0]?.depth).toBe(0);
  });

  it("returns nothing for an empty list", () => {
    expect(buildDocumentTree([])).toEqual([]);
  });
});

describe("visibleTreeRows", () => {
  const roots = () =>
    buildDocumentTree([
      doc("root"),
      doc("child", "root"),
      doc("grandchild", "child"),
      doc("other"),
    ]);

  it("walks the tree depth first", () => {
    expect(titles(visibleTreeRows(roots(), new Set()))).toEqual([
      "root",
      "child",
      "grandchild",
      "other",
    ]);
  });

  it("hides the whole branch under a collapsed node", () => {
    expect(titles(visibleTreeRows(roots(), new Set(["root"])))).toEqual([
      "root",
      "other",
    ]);
  });

  it("collapses only the branch it names", () => {
    expect(titles(visibleTreeRows(roots(), new Set(["child"])))).toEqual([
      "root",
      "child",
      "other",
    ]);
  });
});

describe("ancestorIds", () => {
  const documents = [
    doc("root"),
    doc("child", "root"),
    doc("grandchild", "child"),
  ];

  it("lists the ancestors nearest first", () => {
    expect(ancestorIds(documents, "grandchild")).toEqual(["child", "root"]);
  });

  it("returns nothing for a root", () => {
    expect(ancestorIds(documents, "root")).toEqual([]);
  });

  it("returns nothing when no document is selected", () => {
    expect(ancestorIds(documents, undefined)).toEqual([]);
  });

  it("stops at a parent that is not in the list", () => {
    expect(ancestorIds([doc("kept", "gone")], "kept")).toEqual([]);
  });
});
