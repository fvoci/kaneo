import * as v from "valibot";

const TITLE_MAX_LENGTH = 512;

/** Full document row as returned by single-document reads. */
export const documentSchema = v.object({
  id: v.string(),
  projectId: v.string(),
  parentId: v.nullable(v.string()),
  position: v.string(),
  title: v.string(),
  content: v.nullable(v.string()),
  version: v.number(),
  createdBy: v.nullable(v.string()),
  updatedBy: v.nullable(v.string()),
  archivedAt: v.nullable(v.date()),
  createdAt: v.date(),
  updatedAt: v.date(),
});

/**
 * List rows omit `content` so a project with large documents does not ship
 * every body on every list render, and omit `archivedAt` because listing
 * excludes archived documents.
 */
export const documentSummarySchema = v.object({
  id: v.string(),
  projectId: v.string(),
  parentId: v.nullable(v.string()),
  position: v.string(),
  title: v.string(),
  version: v.number(),
  createdBy: v.nullable(v.string()),
  updatedBy: v.nullable(v.string()),
  createdAt: v.date(),
  updatedAt: v.date(),
});

export const documentListSchema = v.array(documentSummarySchema);

/**
 * `parentId` and `position` are deliberately not accepted yet. The columns
 * exist so the tree (feature 3) lands without a migration, but until that
 * phase ships there is no cycle or sibling-ordering validation, so every
 * document is created as an unordered root.
 */
export const createDocumentSchema = v.object({
  title: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1),
    v.maxLength(TITLE_MAX_LENGTH),
  ),
  content: v.optional(v.string()),
  /**
   * Task ids the editor saw in the body. Advisory only — the server re-parses
   * the body and keeps the intersection, then drops anything outside the
   * document's workspace.
   */
  taskIds: v.optional(v.array(v.string())),
});

/**
 * `version` is the version the client last read. The update is rejected with
 * 409 when it no longer matches the stored row, so a stale editor cannot
 * silently overwrite a concurrent edit.
 */
export const updateDocumentSchema = v.object({
  title: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1),
    v.maxLength(TITLE_MAX_LENGTH),
  ),
  content: v.optional(v.nullable(v.string())),
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
  /**
   * Task ids the editor saw in the body. Advisory only — the server re-parses
   * the body and keeps the intersection, then drops anything outside the
   * document's workspace.
   */
  taskIds: v.optional(v.array(v.string())),
});

/** 409 body: carries the stored version so the client can refetch and merge. */
export const documentVersionConflictSchema = v.object({
  message: v.string(),
  currentVersion: v.number(),
});

/** A document that references a task, as shown in the task's backlink panel. */
export const documentBacklinkSchema = v.object({
  id: v.string(),
  projectId: v.string(),
  title: v.string(),
  updatedAt: v.date(),
  linkedAt: v.date(),
});

export const documentBacklinkListSchema = v.array(documentBacklinkSchema);

/** A task a document references, as shown in its reference section. */
export const documentTaskSchema = v.object({
  id: v.string(),
  title: v.string(),
  number: v.nullable(v.number()),
  status: v.string(),
  priority: v.nullable(v.string()),
  projectId: v.string(),
  projectSlug: v.string(),
  assigneeName: v.nullable(v.string()),
  linkedAt: v.date(),
});

export const documentTaskListSchema = v.array(documentTaskSchema);

export const documentTaskLinkSchema = v.object({
  id: v.string(),
  documentId: v.string(),
  taskId: v.string(),
  createdAt: v.date(),
});

export const linkDocumentTaskSchema = v.object({
  taskId: v.pipe(v.string(), v.minLength(1)),
});

export const documentTaskLinkParamSchema = v.object({
  id: v.string(),
  taskId: v.string(),
});

export const documentIdParamSchema = v.object({ id: v.string() });

export const documentTaskIdParamSchema = v.object({ taskId: v.string() });

export const documentProjectIdParamSchema = v.object({
  projectId: v.string(),
});

export type DocumentInput = v.InferOutput<typeof createDocumentSchema>;
export type DocumentUpdateInput = v.InferOutput<typeof updateDocumentSchema>;
