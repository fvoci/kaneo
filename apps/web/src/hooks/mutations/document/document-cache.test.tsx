import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("@/fetchers/document/create-document", () => ({
  default: vi.fn(async () => ({ id: "d1", projectId: "p1" })),
}));
vi.mock("@/fetchers/document/update-document", () => ({
  default: vi.fn(async () => ({ id: "d1", projectId: "p1", version: 2 })),
  DocumentVersionConflictError: class extends Error {},
}));
vi.mock("@/fetchers/document/delete-document", () => ({
  default: vi.fn(async () => ({ id: "d1" })),
}));

import useCreateDocument from "@/hooks/mutations/document/use-create-document";
import useDeleteDocument from "@/hooks/mutations/document/use-delete-document";
import useUpdateDocument from "@/hooks/mutations/document/use-update-document";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnMount: false },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/**
 * The backlink panel lives on the task side and reads `["task-documents"]`.
 * Nothing on that screen knows a document was saved, and the query client is
 * configured with `refetchOnMount: false`, so without an explicit invalidation
 * a task keeps showing links the document no longer has.
 */
async function expectBacklinksInvalidated(
  run: (client: QueryClient) => Promise<void>,
) {
  const client = makeClient();
  client.setQueryData(["task-documents", "t1"], [{ id: "stale" }]);
  expect(client.getQueryState(["task-documents", "t1"])?.isInvalidated).toBe(
    false,
  );

  await run(client);

  await waitFor(() => {
    expect(client.getQueryState(["task-documents", "t1"])?.isInvalidated).toBe(
      true,
    );
  });
}

describe("document mutations invalidate task backlinks", () => {
  it("invalidates after a save", async () => {
    await expectBacklinksInvalidated(async (client) => {
      const { result } = renderHook(() => useUpdateDocument("p1"), {
        wrapper: wrapperFor(client),
      });
      await act(async () => {
        await result.current.mutateAsync({
          id: "d1",
          title: "T",
          content: "",
          version: 1,
        });
      });
    });
  });

  it("invalidates after a create", async () => {
    await expectBacklinksInvalidated(async (client) => {
      const { result } = renderHook(() => useCreateDocument(), {
        wrapper: wrapperFor(client),
      });
      await act(async () => {
        await result.current.mutateAsync({ projectId: "p1", title: "T" });
      });
    });
  });

  it("invalidates after a delete", async () => {
    await expectBacklinksInvalidated(async (client) => {
      const { result } = renderHook(() => useDeleteDocument("p1"), {
        wrapper: wrapperFor(client),
      });
      await act(async () => {
        await result.current.mutateAsync("d1");
      });
    });
  });
});
