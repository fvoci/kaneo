const ISSUE_LINK_TAG = /<kaneo-issue-link\b[^>]*>/gi;
const TASK_ID_ATTR = /\btask-id="([^"]*)"/i;
const URL_ATTR = /\burl="([^"]*)"/i;
const TASK_ID_IN_URL = /\/task\/([a-z0-9]+)(?:[/?#]|$)/i;

function decodeAttribute(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Task ids referenced by a document body, read from the Markdown the editor
 * produced. Sent alongside a save so the server knows what the editor saw; the
 * server re-parses the body and keeps only the intersection, so this is a hint
 * rather than a source of truth.
 *
 * Falls back to the URL for bodies written before the editor round-tripped the
 * `task-id` attribute.
 */
export function parseTaskLinkIds(content: string | null | undefined): string[] {
  if (!content) return [];

  const ids = new Set<string>();

  for (const tag of content.match(ISSUE_LINK_TAG) ?? []) {
    const fromAttribute = tag.match(TASK_ID_ATTR)?.[1]?.trim();
    if (fromAttribute) {
      ids.add(fromAttribute);
      continue;
    }

    const url = tag.match(URL_ATTR)?.[1];
    if (!url) continue;
    const fromUrl = decodeAttribute(url).match(TASK_ID_IN_URL)?.[1];
    if (fromUrl) ids.add(fromUrl);
  }

  return [...ids];
}

export default parseTaskLinkIds;
