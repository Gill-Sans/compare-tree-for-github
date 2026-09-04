/**
 * GitHub page adapter. Every selector, URL rule, anchor formula, and layout hook lives here,
 * so a GitHub markup change is a change to this one file.
 */

export interface CompareParts {
  owner: string;
  repo: string;
  range: string;
}

export const SELECTORS = {
  bucket: '#files_bucket',
  diff: '#files_bucket #diff',
  files: '#files_bucket #files',
  filesTab: 'a.js-compare-tab[href="#files_bucket"]',
  fileHeader: '.file-header[data-path]',
} as const;

export const HOST_TAG = 'compare-tree-sidebar';
export const OPEN_ATTR = 'data-ctg-open';
export const PAGE_STYLE_ID = 'ctg-page-style';
export const DEFAULT_STICKY_TOP = 8;

const COMPARE_PATH = /^\/([^/]+)\/([^/]+)\/compare\/(.+)$/;

/** Owner, repo, and raw (still URL-encoded) range of a compare URL, or null for any other URL. */
export function parseCompareUrl(url: string): CompareParts | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = COMPARE_PATH.exec(parsed.pathname);
  if (!match) return null;
  const [, owner, repo, rawRange] = match;
  if (!owner || !repo || !rawRange) return null;
  const range = rawRange.replace(/\/+$/, '');
  if (!range) return null;
  return { owner, repo, range };
}

export function diffUrl(parts: CompareParts, origin: string): string {
  return `${origin}/${parts.owner}/${parts.repo}/compare/${parts.range}.diff`;
}

export function compareKey(parts: CompareParts): string {
  return `${parts.owner}/${parts.repo}/${parts.range}`;
}

/** GitHub's diff anchor: "diff-" plus the hex SHA-256 of the UTF-8 path (the new path for renames). */
export async function anchorFor(path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return `diff-${hex}`;
}
