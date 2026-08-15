/**
 * The identifier shown for a document, e.g. "P2-D1".
 *
 * Qualified by the project slug like a task key, because a document can be
 * referenced from another project in the same workspace and a bare number
 * would name two different documents there. The "D" keeps it apart from a task
 * key, whose number follows the dash directly.
 *
 * Returns undefined while the project is still loading, so callers can leave
 * the slot empty rather than render a half-built key.
 */
export function documentKey(
  projectSlug: string | undefined,
  number: number | undefined | null,
) {
  if (!projectSlug || number === undefined || number === null) return undefined;
  return `${projectSlug}-D${number}`;
}
