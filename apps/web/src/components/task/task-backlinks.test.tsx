import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskBacklinks from "./task-backlinks";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  taskDocuments: vi.fn(),
  canManageTasks: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <span className={className}>{children}</span>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/document/use-get-task-documents", () => ({
  useGetTaskDocuments: () => mocks.taskDocuments(),
}));
vi.mock("@/hooks/queries/document/use-get-documents", () => ({
  useGetDocuments: () => ({
    data: [
      { id: "d1", number: 1, title: "이미 연결된 문서", projectId: "p1" },
      { id: "d2", number: 2, title: "아직 연결 안 된 문서", projectId: "p1" },
    ],
  }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { slug: "P2" } }),
}));
vi.mock("@/hooks/mutations/document/use-link-document-task", () => ({
  default: () => ({ mutate: mocks.link }),
}));
vi.mock("@/hooks/mutations/document/use-unlink-document-task", () => ({
  default: () => ({ mutate: mocks.unlink }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canManageTasks: mocks.canManageTasks }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/components/common/link-picker", () => ({
  default: ({
    open,
    items,
    onSelect,
  }: {
    open: boolean;
    items: Array<{ id: string; label: string; hint?: string }>;
    onSelect: (id: string) => void;
  }) =>
    open ? (
      <div data-testid="picker">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`candidate-${item.id}`}
            onClick={() => onSelect(item.id)}
          >
            <span data-testid={`hint-${item.id}`}>{item.hint}</span>
            {item.label}
          </button>
        ))}
      </div>
    ) : null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LINKED_DOCUMENT = {
  id: "d1",
  projectId: "p1",
  projectSlug: "P2",
  number: 1,
  title: "이미 연결된 문서",
};

async function openRowMenu(documentTitle: string) {
  fireEvent.contextMenu(screen.getByText(documentTitle));
  await waitFor(() =>
    expect(screen.getByText("documents:backlinks.openDocument")).toBeTruthy(),
  );
}

function renderPanel() {
  return render(<TaskBacklinks taskId="t1" projectId="p1" workspaceId="w1" />);
}

describe("TaskBacklinks", () => {
  it("lists the documents that reference the task", () => {
    mocks.canManageTasks.mockReturnValue(true);
    mocks.taskDocuments.mockReturnValue({ data: [LINKED_DOCUMENT] });

    renderPanel();

    expect(screen.getByText("이미 연결된 문서")).toBeTruthy();
  });

  it("shows each document's key, built from its own project", async () => {
    // A backlink may name a document in another project, so the key comes from
    // the row rather than from the task's project.
    mocks.canManageTasks.mockReturnValue(true);
    mocks.taskDocuments.mockReturnValue({
      data: [{ ...LINKED_DOCUMENT, projectSlug: "OPS", number: 4 }],
    });

    renderPanel();

    expect(screen.getByText("OPS-D4")).toBeTruthy();
  });

  it("offers picker candidates by key", () => {
    mocks.canManageTasks.mockReturnValue(true);
    mocks.taskDocuments.mockReturnValue({ data: [] });

    renderPanel();
    fireEvent.click(screen.getByLabelText("documents:backlinks.add"));

    expect(screen.getByTestId("hint-d2").textContent).toBe("P2-D2");
  });

  it("renders the section even with nothing linked", () => {
    mocks.canManageTasks.mockReturnValue(true);
    mocks.taskDocuments.mockReturnValue({ data: [] });

    renderPanel();

    expect(screen.getByText("documents:backlinks.title")).toBeTruthy();
    expect(screen.getByText("documents:backlinks.empty")).toBeTruthy();
  });

  it("offers only documents that are not linked yet", () => {
    mocks.canManageTasks.mockReturnValue(true);
    mocks.taskDocuments.mockReturnValue({ data: [LINKED_DOCUMENT] });

    renderPanel();
    fireEvent.click(screen.getByLabelText("documents:backlinks.add"));

    expect(screen.queryByTestId("candidate-d1")).toBeNull();
    expect(screen.getByTestId("candidate-d2")).toBeTruthy();
  });

  it("links the document the picker returns, against this task", () => {
    // Same row as the document side writes, reached from the other end.
    mocks.canManageTasks.mockReturnValue(true);
    mocks.taskDocuments.mockReturnValue({ data: [LINKED_DOCUMENT] });

    renderPanel();
    fireEvent.click(screen.getByLabelText("documents:backlinks.add"));
    fireEvent.click(screen.getByTestId("candidate-d2"));

    expect(mocks.link).toHaveBeenCalledTimes(1);
    expect(mocks.link.mock.calls[0][0]).toEqual({
      documentId: "d2",
      taskId: "t1",
    });
  });

  it("unlinks by the document and task pair, without a confirmation step", async () => {
    mocks.canManageTasks.mockReturnValue(true);
    mocks.taskDocuments.mockReturnValue({ data: [LINKED_DOCUMENT] });

    renderPanel();
    await openRowMenu("이미 연결된 문서");
    fireEvent.click(screen.getByText("documents:backlinks.remove"));

    expect(mocks.unlink).toHaveBeenCalledTimes(1);
    expect(mocks.unlink.mock.calls[0][0]).toEqual({
      documentId: "d1",
      taskId: "t1",
    });
  });

  it("hides the add button and the remove item without task permission", async () => {
    mocks.canManageTasks.mockReturnValue(false);
    mocks.taskDocuments.mockReturnValue({ data: [LINKED_DOCUMENT] });

    renderPanel();

    expect(screen.queryByLabelText("documents:backlinks.add")).toBeNull();

    await openRowMenu("이미 연결된 문서");
    expect(screen.queryByText("documents:backlinks.remove")).toBeNull();
  });

  it("opens the document in its own project, not the task's", async () => {
    // A document in another project of the workspace can reference this task.
    mocks.canManageTasks.mockReturnValue(true);
    mocks.taskDocuments.mockReturnValue({
      data: [{ ...LINKED_DOCUMENT, projectId: "p2" }],
    });

    renderPanel();
    await openRowMenu("이미 연결된 문서");
    fireEvent.click(screen.getByText("documents:backlinks.openDocument"));

    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { workspaceId: "w1", projectId: "p2", documentId: "d1" },
      }),
    );
  });
});
