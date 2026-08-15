// Extract the tasks a document body links to. Mirrors `parse-mentions`, which
// reads the `<kaneo-mention>` tag the editor serializes mentions to.
//
// `task-id` is the canonical attribute, but documents saved before the editor
// learned to round-trip it carry an empty one. The URL survived those saves, so
// it is used as a fallback and older bodies keep working.
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
