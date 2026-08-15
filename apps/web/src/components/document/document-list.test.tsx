import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DocumentList from "./document-list";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

afterEach(cleanup);

const DOCUMENTS = [
  {
    id: "d1",
    projectId: "p1",
    parentId: null,
    position: 0,
    number: 7,
    title: "프로토콜",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
] as never;

function renderList(props: Record<string, unknown> = {}) {
  const onSelect = vi.fn();
  const onDelete = vi.fn();
  const utils = render(
    <DocumentList
      documents={DOCUMENTS}
      selectedId={undefined}
      projectSlug="P2"
      canDelete={true}
      onSelect={onSelect}
      onDelete={onDelete}
      {...props}
    />,
  );
  return { ...utils, onSelect, onDelete };
}

async function openRowMenu(title: string) {
  fireEvent.contextMenu(screen.getByText(title));
  await waitFor(() => expect(screen.getByText("documents:open")).toBeTruthy());
}

const TREE = [
  {
    id: "root",
    projectId: "p1",
    parentId: null,
    position: 0,
    number: 1,
    title: "Root",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "child",
    projectId: "p1",
    parentId: "root",
    position: 0,
    number: 2,
    title: "Child",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "grandchild",
    projectId: "p1",
    parentId: "child",
    position: 0,
    number: 3,
    title: "Grandchild",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
] as never;

/** The disclosure control on a specific row, since several rows have one. */
function toggleFor(title: string) {
  const row = screen.getByText(title).closest("li");
  const button = row?.querySelector("button[aria-expanded]");
  if (!button) throw new Error(`no toggle on the row for ${title}`);
  return button;
}

describe("DocumentList as a tree", () => {
  it("indents each level and leaves the top level flush", () => {
    renderList({ documents: TREE });

    const indentOf = (title: string) =>
      screen.getByText(title).closest("li")?.style.paddingInlineStart;

    expect(indentOf("Root")).toBe("0px");
    expect(indentOf("Child")).toBe("16px");
    expect(indentOf("Grandchild")).toBe("32px");
  });

  it("hides a whole branch when its parent is collapsed", () => {
    renderList({ documents: TREE });

    fireEvent.click(toggleFor("Root"));

    expect(screen.queryByText("Child")).toBeNull();
    expect(screen.queryByText("Grandchild")).toBeNull();
    expect(screen.getByText("Root")).toBeTruthy();
  });

  it("brings the branch back when expanded again", () => {
    renderList({ documents: TREE });

    fireEvent.click(toggleFor("Root"));
    fireEvent.click(toggleFor("Root"));

    expect(screen.getByText("Child")).toBeTruthy();
    expect(screen.getByText("Grandchild")).toBeTruthy();
  });

  it("gives a leaf no toggle to press", () => {
    renderList({ documents: [TREE[2]] as never });

    expect(
      screen
        .getByText("Grandchild")
        .closest("li")
        ?.querySelector("button[aria-expanded]"),
    ).toBeNull();
  });

  // Arriving at a nested document from a backlink or a URL must not leave it
  // hidden inside a branch that happened to be collapsed.
  it("opens the branch a selected document sits in", () => {
    const { rerender } = renderList({ documents: TREE });

    fireEvent.click(toggleFor("Root"));
    expect(screen.queryByText("Grandchild")).toBeNull();

    rerender(
      <DocumentList
        documents={TREE}
        selectedId="grandchild"
        projectSlug="P2"
        canDelete={true}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("Grandchild")).toBeTruthy();
  });

  it("opens the document a row names, not its branch", () => {
    const { onSelect } = renderList({ documents: TREE });

    fireEvent.click(screen.getByText("Child"));

    expect(onSelect).toHaveBeenCalledWith("child");
  });
});

describe("DocumentList", () => {
  it("shows the document key next to the title", () => {
    // Documents are told apart by their key the way tasks are, so a row of
    // untitled documents is still distinguishable.
    renderList();

    expect(screen.getByText("P2-D7")).toBeTruthy();
  });

  it("leaves the key out until the project slug is known", () => {
    renderList({ projectSlug: undefined });

    expect(screen.queryByText(/-D7$/)).toBeNull();
    expect(screen.getByText("프로토콜")).toBeTruthy();
  });

  it("opens a document when its row is clicked", () => {
    const { onSelect } = renderList();

    fireEvent.click(screen.getByText("프로토콜"));

    expect(onSelect).toHaveBeenCalledWith("d1");
  });

  it("asks to delete the row that was right-clicked", async () => {
    // Deleting is reachable from the list, so a document no longer has to be
    // open to be removed.
    const { onDelete } = renderList();

    await openRowMenu("프로토콜");
    fireEvent.click(screen.getByText("documents:delete"));

    // Deferred, not synchronous: the menu has to finish closing before the
    // confirmation dialog opens, or the two fight over focus.
    expect(onDelete).not.toHaveBeenCalled();

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete.mock.calls[0][0].id).toBe("d1");
  });

  it("hides delete without permission but still offers opening", async () => {
    renderList({ canDelete: false });

    await openRowMenu("프로토콜");

    expect(screen.queryByText("documents:delete")).toBeNull();
  });
});
