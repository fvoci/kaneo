import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

/**
 * Stands in for the rich editor and emits an edit the same way CommentEditor's
 * `onUpdate` does — by handing the parent a Markdown string. The Markdown that
 * a real editor produces is covered by `editor-markdown.test.ts`; what matters
 * here is that an edit reaches the save payload at all.
 */
vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (value: string) => void;
  }) => (
    <div>
      <span data-testid="editor-value">{value}</span>
      <button
        type="button"
        data-testid="editor-emit"
        onClick={() => onChange?.("## 타이핑한 본문\n\n내용")}
      >
        emit
      </button>
      <button
        type="button"
        data-testid="editor-emit-link"
        onClick={() =>
          onChange?.(
            '본문 <kaneo-issue-link url="https://kaneo.test/dashboard/workspace/w/project/p/task/task-1" issue-key="" task-id="task-1" />',
          )
        }
      >
        emit link
      </button>
    </div>
  ),
}));

vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { slug: "P2" } }),
}));

vi.mock("@/components/document/document-task-references", () => ({
  default: () => <div data-testid="task-references" />,
}));

import DocumentEditor from "@/components/document/document-editor";

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    projectId: "p1",
    parentId: null,
    position: 0,
    title: "제목",
    content: "",
    version: 1,
    number: 3,
    createdBy: "u1",
    updatedBy: "u1",
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as never;
}

function renderEditor(
  documentOverrides: Record<string, unknown> = {},
  props: Record<string, unknown> = {},
) {
  const onSave = vi.fn();
  const utils = render(
    <DocumentEditor
      document={makeDocument(documentOverrides)}
      isSaving={false}
      conflictVersion={null}
      workspaceId="w1"
      onSave={onSave}
      onReloadAfterConflict={vi.fn()}
      {...props}
    />,
  );

  const saveButton = () =>
    [...utils.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("documents:save"),
    ) as HTMLButtonElement | undefined;

  return { ...utils, onSave, saveButton };
}

describe("DocumentEditor save wiring", () => {
  it("starts with saving disabled when nothing has been edited", () => {
    const { saveButton } = renderEditor({ content: "## 기존" });
    expect(saveButton()?.disabled).toBe(true);
  });

  it("enables saving once the editor reports an edit", async () => {
    const { getByTestId, saveButton } = renderEditor();
    expect(saveButton()?.disabled).toBe(true);

    await act(async () => {
      fireEvent.click(getByTestId("editor-emit"));
    });

    expect(saveButton()?.disabled).toBe(false);
  });

  it("sends the edited body rather than the initial empty value", async () => {
    // The regression this guards: the body renders in the editor but the save
    // payload still carries the value the component started with.
    const { getByTestId, saveButton, onSave } = renderEditor({ content: "" });

    await act(async () => {
      fireEvent.click(getByTestId("editor-emit"));
    });
    await act(async () => {
      const button = saveButton();
      if (button) fireEvent.click(button);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      title: "제목",
      content: "## 타이핑한 본문\n\n내용",
      version: 1,
    });
  });

  it("sends the edited body when replacing existing content", async () => {
    const { getByTestId, saveButton, onSave } = renderEditor({
      content: "## 기존 본문",
      version: 4,
    });

    await act(async () => {
      fireEvent.click(getByTestId("editor-emit"));
    });
    await act(async () => {
      const button = saveButton();
      if (button) fireEvent.click(button);
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "## 타이핑한 본문\n\n내용",
        version: 4,
      }),
    );
  });

  it("saves an issue link in the body without turning it into a reference", async () => {
    // An inline chip navigates to a task; it does not relate the document to
    // one. References are created through the link endpoints, so the save
    // payload carries the body and nothing derived from it.
    const { getByTestId, saveButton, onSave } = renderEditor({ content: "" });

    await act(async () => {
      fireEvent.click(getByTestId("editor-emit-link"));
    });
    await act(async () => {
      const button = saveButton();
      if (button) fireEvent.click(button);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const [draft] = onSave.mock.calls[0];
    expect(draft.content).toContain('task-id="task-1"');
    expect(Object.keys(draft).sort()).toEqual(["content", "title", "version"]);
  });

  it("shows the document key in the header", () => {
    const { getByText } = renderEditor();
    expect(getByText("P2-D3")).toBeTruthy();
  });

  it("hands the stored body to the editor on open", () => {
    const { getByTestId } = renderEditor({ content: "## 저장된 본문" });
    expect(getByTestId("editor-value").textContent).toBe("## 저장된 본문");
  });

  it("keeps the draft when a conflict is reported", async () => {
    const { getByTestId, saveButton, onSave, rerender } = renderEditor({
      content: "",
    });

    await act(async () => {
      fireEvent.click(getByTestId("editor-emit"));
    });

    // A 409 re-renders with a conflict version but must not reset the draft.
    await act(async () => {
      rerender(
        <DocumentEditor
          document={makeDocument({ content: "" })}
          isSaving={false}
          conflictVersion={9}
          workspaceId="w1"
          onSave={onSave}
          onReloadAfterConflict={vi.fn()}
        />,
      );
    });

    expect(getByTestId("editor-value").textContent).toBe(
      "## 타이핑한 본문\n\n내용",
    );
    await act(async () => {
      const button = saveButton();
      if (button) fireEvent.click(button);
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ content: "## 타이핑한 본문\n\n내용" }),
    );
  });
});
