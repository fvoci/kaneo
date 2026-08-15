import type { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";

export type Document = InferResponseType<
  (typeof client)["document"][":id"]["$get"],
  200
>;

export type DocumentSummary = InferResponseType<
  (typeof client)["document"]["project"][":projectId"]["$get"],
  200
>[number];

/** A task a document references, as listed in its reference section. */
export type DocumentTask = InferResponseType<
  (typeof client)["document"][":id"]["tasks"]["$get"],
  200
>[number];
