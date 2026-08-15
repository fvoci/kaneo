import type { DocumentSummary } from "@/types/document";

export type DocumentTreeNode = {
  document: DocumentSummary;
  depth: number;
  children: DocumentTreeNode[];
};

/**
 * Turns the flat list the API returns into the tree the sidebar draws.
 *
 * There is no orphan case to handle. Archiving a document archives its subtree,
 * so a document in this list has either no parent or a parent that is also in
 * it. That is an invariant the server holds, not a rule this function enforces
 * — but a row whose parent is missing would otherwise vanish from the tree
 * entirely, so it is attached at the root rather than dropped. Silently losing
 * a document from the list is worse than drawing one at the wrong indent.
 *
 * Siblings keep the order they arrive in. The list is already sorted by
 * position with `createdAt` and `id` breaking ties, and re-sorting here would
 * mean two places deciding the same thing.
 */
export function buildDocumentTree(
  documents: DocumentSummary[],
): DocumentTreeNode[] {
  const nodes = new Map<string, DocumentTreeNode>(
    documents.map((document) => [
      document.id,
      { document, depth: 0, children: [] },
    ]),
  );

  const roots: DocumentTreeNode[] = [];

  for (const document of documents) {
    const node = nodes.get(document.id);
    if (!node) continue;

    const parent = document.parentId ? nodes.get(document.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const setDepth = (node: DocumentTreeNode, depth: number) => {
    node.depth = depth;
    for (const child of node.children) setDepth(child, depth + 1);
  };
  for (const root of roots) setDepth(root, 0);

  return roots;
}

/**
 * The tree flattened back into rows, skipping anything under a collapsed
 * parent. Rendering from a flat array keeps the row markup in one place and one
 * loop, which is also what a keyboard or a virtualised list would want.
 */
export function visibleTreeRows(
  roots: DocumentTreeNode[],
  collapsed: ReadonlySet<string>,
): DocumentTreeNode[] {
  const rows: DocumentTreeNode[] = [];

  const walk = (node: DocumentTreeNode) => {
    rows.push(node);
    if (collapsed.has(node.document.id)) return;
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);

  return rows;
}

/**
 * The ancestors of a document, nearest first. The sidebar uses it to open the
 * branch a selected document sits in, so navigating to a nested document does
 * not leave it hidden inside a collapsed parent.
 */
export function ancestorIds(
  documents: DocumentSummary[],
  id: string | undefined,
): string[] {
  if (!id) return [];

  const byId = new Map(documents.map((document) => [document.id, document]));
  const ancestors: string[] = [];

  let current = byId.get(id)?.parentId ?? null;
  while (current) {
    const parent = byId.get(current);
    if (!parent) break;
    ancestors.push(parent.id);
    current = parent.parentId;
  }

  return ancestors;
}
