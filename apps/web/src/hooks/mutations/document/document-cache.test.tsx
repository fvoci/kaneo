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
 * Seeds both caches a document mutation can touch: the project's document list
 * and one task's backlink panel. The client is configured with
 * `refetchOnMount: false`, so whatever is not invalidated here is what a screen
 * keeps showing.
 */
async function runMutation(run: (client: QueryClient) => Promise<void>) {
  const client = makeClient();
  client.setQueryData(["documents", "p1"], []);
  client.setQueryData(["task-documents", "t1"], [{ id: "stale" }]);

  await run(client);

  await waitFor(() => {
    expect(client.getQueryState(["documents", "p1"])?.isInvalidated).toBe(true);
  });
  return client;
}

const backlinksInvalidated = (client: QueryClient) =>
  client.getQueryState(["task-documents", "t1"])?.isInvalidated;

/**
 * Which tasks a document references is decided by the link endpoints, and those
 * invalidate the exact task they touched. Only a mutation that can change a
 * link without going through them has any business invalidating the whole
 * prefix — archiving is the one that can.
 */
describe("document mutations and task backlinks", () => {
  // A save rewrites the body, and the body has not created references since
  // links became explicit. Invalidating the prefix here would refetch every
  // open backlink panel on every save.
  it("leaves every task's backlinks alone after a save", async () => {
    const client = await runMutation(async (client) => {
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

    expect(backlinksInvalidated(client)).toBe(false);
  });

  // A document that does not exist yet cannot be linked to anything.
  it("leaves every task's backlinks alone after a create", async () => {
    const client = await runMutation(async (client) => {
      const { result } = renderHook(() => useCreateDocument(), {
        wrapper: wrapperFor(client),
      });
      await act(async () => {
        await result.current.mutateAsync({ projectId: "p1", title: "T" });
      });
    });

    expect(backlinksInvalidated(client)).toBe(false);
  });

  // Archiving drops the document out of every backlink list without any link
  // row changing, so nothing else will invalidate those panels.
  it("invalidates after a delete", async () => {
    const client = await runMutation(async (client) => {
      const { result } = renderHook(() => useDeleteDocument("p1"), {
        wrapper: wrapperFor(client),
      });
      await act(async () => {
        await result.current.mutateAsync("d1");
      });
    });

    expect(backlinksInvalidated(client)).toBe(true);
  });
});
