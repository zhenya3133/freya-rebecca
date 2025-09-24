// apps/web/src/lib/source_id.ts

/**
 * Единообразные source_id — пригодятся для дедупликации/апдейтов.
 */

export function sourceIdForGitHub(
  owner: string,
  repo: string,
  ref: string | null | undefined,
  path: string
): string {
  const safeRef = ref ?? "main";
  // gh:owner/repo@ref:path/to/file
  return `gh:${owner}/${repo}@${safeRef}:${path}`;
}

export function sourceIdForUrl(url: string): string {
  // url:https://example.com/path
  return `url:${url}`;
}

export { sourceIdForUrl as sourceIdForURL };