import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const getTaskDocuments = vi.fn(async (_taskId: string) => []);
const getDocuments = vi.fn(async (_projectId: string) => []);
const getDocument = vi.fn(async (_id: string) => ({ id: "d1" }));

vi.mock("@/fetchers/document/get-task-documents", () => ({
  default: (taskId: string) => getTaskDocuments(taskId),
}));
vi.mock("@/fetchers/document/get-documents", () => ({
  default: (projectId: string) => getDocuments(projectId),
}));
vi.mock("@/fetchers/document/get-document", () => ({
  default: (id: string) => getDocument(id),
}));

import { useGetDocument } from "@/hooks/queries/document/use-get-document";
import { useGetDocuments } from "@/hooks/queries/document/use-get-documents";
import { useGetTaskDocuments } from "@/hooks/queries/document/use-get-task-documents";

/**
 * Documents are edited on one screen and read on another, so cached data goes
 * out of date without the reading screen ever knowing. The app's query client
 * sets `refetchOnMount: false`, which would serve that stale copy; each
 * document query opts back in so a mount always shows current data.
 *
 * This is a correctness property, not a nicety: it must hold with no
 * websocket, on a second device, and after a dropped connection.
 */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      // Same defaults as `@/query-client`.
      queries: {
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("document queries are fresh on mount", () => {
  it("refetches task backlinks even when a cached list exists", async () => {
    getTaskDocuments.mockClear();
    const client = makeClient();
    // The list cached before a document was deleted elsewhere.
    client.setQueryData(["task-documents", "t1"], [{ id: "deleted-doc" }]);

    renderHook(() => useGetTaskDocuments("t1"), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => {
      expect(getTaskDocuments).toHaveBeenCalledWith("t1");
    });
  });

  it("refetches the document list even when a cached list exists", async () => {
    getDocuments.mockClear();
    const client = makeClient();
    client.setQueryData(["documents", "p1"], [{ id: "stale-doc" }]);

    renderHook(() => useGetDocuments("p1"), { wrapper: wrapperFor(client) });

    await waitFor(() => {
      expect(getDocuments).toHaveBeenCalledWith("p1");
    });
  });

  it("refetches a single document even when a cached copy exists", async () => {
    // Opening a document must not hand the editor a body someone else has
    // already replaced; a stale copy also carries a stale version.
    getDocument.mockClear();
    const client = makeClient();
    client.setQueryData(["document", "d1"], { id: "d1", content: "old" });

    renderHook(() => useGetDocument("d1"), { wrapper: wrapperFor(client) });

    await waitFor(() => {
      expect(getDocument).toHaveBeenCalledWith("d1");
    });
  });

  it("does not fetch without an id", () => {
    getTaskDocuments.mockClear();
    getDocument.mockClear();
    const client = makeClient();

    renderHook(() => useGetTaskDocuments(undefined), {
      wrapper: wrapperFor(client),
    });
    renderHook(() => useGetDocument(undefined), {
      wrapper: wrapperFor(client),
    });

    expect(getTaskDocuments).not.toHaveBeenCalled();
    expect(getDocument).not.toHaveBeenCalled();
  });
});
