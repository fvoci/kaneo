import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DocumentTaskReferences from "./document-task-references";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  documentTasks: vi.fn(),
  canManageTasks: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/document/use-get-document-tasks", () => ({
  useGetDocumentTasks: () => mocks.documentTasks(),
}));
vi.mock("@/hooks/mutations/document/use-link-document-task", () => ({
  default: () => ({ mutate: mocks.link }),
}));
vi.mock("@/hooks/mutations/document/use-unlink-document-task", () => ({
  default: () => ({ mutate: mocks.unlink }),
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => ({
    data: {
      columns: [
        {
          tasks: [
            {
              id: "t1",
              title: "이미 참조한 태스크",
              number: 1,
              status: "to-do",
            },
            {
              id: "t2",
              title: "아직 참조 안 한 태스크",
              number: 2,
              status: "to-do",
            },
          ],
        },
      ],
    },
  }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { slug: "KAN" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canManageTasks: mocks.canManageTasks }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// The picker is a portalled command dialog; this suite cares about what it is
// handed and what selecting an item does, not how it renders.
vi.mock("@/components/common/link-picker", () => ({
  default: ({
    open,
    items,
    onSelect,
  }: {
    open: boolean;
    items: Array<{ id: string; label: string }>;
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

const REFERENCED_TASK = {
  id: "t1",
  title: "이미 참조한 태스크",
  number: 1,
  status: "to-do",
  projectId: "p1",
  projectSlug: "KAN",
};

/** Row actions live behind a right-click, the way task relations expose them. */
async function openRowMenu(taskTitle: string) {
  fireEvent.contextMenu(screen.getByText(taskTitle));
  await waitFor(() =>
    expect(screen.getByText("documents:references.openTask")).toBeTruthy(),
  );
}

function renderSection() {
  return render(
    <DocumentTaskReferences documentId="d1" projectId="p1" workspaceId="w1" />,
  );
}

describe("DocumentTaskReferences", () => {
  it("lists the referenced tasks with their issue key", () => {
    mocks.canManageTasks.mockReturnValue(true);
    mocks.documentTasks.mockReturnValue({ data: [REFERENCED_TASK] });

    renderSection();

    expect(screen.getByText("이미 참조한 태스크")).toBeTruthy();
    expect(screen.getByText("KAN-1")).toBeTruthy();
  });

  it("renders the section even with nothing referenced", () => {
    mocks.canManageTasks.mockReturnValue(true);
    mocks.documentTasks.mockReturnValue({ data: [] });

    renderSection();

    expect(screen.getByText("documents:references.title")).toBeTruthy();
    expect(screen.getByText("documents:references.empty")).toBeTruthy();
  });

  it("unlinks by the document and task pair, without a confirmation step", async () => {
    // Relations remove immediately; a reference is the same kind of row.
    mocks.canManageTasks.mockReturnValue(true);
    mocks.documentTasks.mockReturnValue({ data: [REFERENCED_TASK] });

    renderSection();
    await openRowMenu("이미 참조한 태스크");
    fireEvent.click(screen.getByText("documents:references.remove"));

    expect(mocks.unlink).toHaveBeenCalledTimes(1);
    expect(mocks.unlink.mock.calls[0][0]).toEqual({
      documentId: "d1",
      taskId: "t1",
    });
  });

  it("hides the add button and the remove item without task permission", async () => {
    mocks.canManageTasks.mockReturnValue(false);
    mocks.documentTasks.mockReturnValue({ data: [REFERENCED_TASK] });

    renderSection();

    expect(screen.queryByLabelText("documents:references.add")).toBeNull();

    // Reading and opening the task stay available; only removing is gone.
    await openRowMenu("이미 참조한 태스크");
    expect(screen.queryByText("documents:references.remove")).toBeNull();
  });

  it("offers only tasks that are not referenced yet", () => {
    mocks.canManageTasks.mockReturnValue(true);
    mocks.documentTasks.mockReturnValue({ data: [REFERENCED_TASK] });

    renderSection();
    fireEvent.click(screen.getByLabelText("documents:references.add"));

    expect(screen.queryByTestId("candidate-t1")).toBeNull();
    expect(screen.getByTestId("candidate-t2")).toBeTruthy();
  });

  it("links the task the picker returns", () => {
    mocks.canManageTasks.mockReturnValue(true);
    mocks.documentTasks.mockReturnValue({ data: [REFERENCED_TASK] });

    renderSection();
    fireEvent.click(screen.getByLabelText("documents:references.add"));
    fireEvent.click(screen.getByTestId("candidate-t2"));

    expect(mocks.link).toHaveBeenCalledTimes(1);
    expect(mocks.link.mock.calls[0][0]).toEqual({
      documentId: "d1",
      taskId: "t2",
    });
  });

  it("opens the task in its own project, not the document's", () => {
    // A reference may point at a task in another project of the workspace.
    mocks.canManageTasks.mockReturnValue(true);
    mocks.documentTasks.mockReturnValue({
      data: [{ ...REFERENCED_TASK, projectId: "p2", projectSlug: "OPS" }],
    });

    renderSection();
    fireEvent.click(screen.getByText("이미 참조한 태스크"));

    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { workspaceId: "w1", projectId: "p2", taskId: "t1" },
      }),
    );
  });
});
