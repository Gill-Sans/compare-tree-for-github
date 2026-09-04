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

export interface DiffRoot {
  bucket: HTMLElement;
  diff: HTMLElement;
  files: HTMLElement;
}

export function findDiffRoot(doc: Document = document): DiffRoot | null {
  const bucket = doc.querySelector<HTMLElement>(SELECTORS.bucket);
  const diff = doc.querySelector<HTMLElement>(SELECTORS.diff);
  const files = doc.querySelector<HTMLElement>(SELECTORS.files);
  return bucket && diff && files ? { bucket, diff, files } : null;
}

export interface WaitOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  doc?: Document;
}

/** Resolve with the first element matching `selector`, now or when it is added to the page. */
export function waitFor(selector: string, options: WaitOptions = {}): Promise<Element> {
  const { timeoutMs = 15_000, signal, doc = document } = options;
  return new Promise((resolve, reject) => {
    const existing = doc.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(check);
    function cleanup(): void {
      observer.disconnect();
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    function onAbort(): void {
      cleanup();
      reject(abortError());
    }
    function check(): void {
      const found = doc.querySelector(selector);
      if (found) {
        cleanup();
        resolve(found);
      }
    }
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${selector}`));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/** The number in GitHub's "Files changed N" tab label, or null when it cannot be read. */
export function readTabFileCount(doc: Document = document): number | null {
  const tab = doc.querySelector(SELECTORS.filesTab);
  const match = /files changed\D*(\d[\d,. ]*)/i.exec(tab?.textContent ?? '');
  if (!match) return null;
  const digits = (match[1] ?? '').replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

const PAGE_CSS = `
#files_bucket[${OPEN_ATTR}] #diff {
  display: grid;
  grid-template-columns: var(--ctg-sidebar-width, 320px) minmax(0, 1fr);
  column-gap: 16px;
  align-items: start;
}
#files_bucket[${OPEN_ATTR}] #diff > * { grid-column: 1 / -1; }
#files_bucket[${OPEN_ATTR}] #diff > ${HOST_TAG} {
  grid-column: 1;
  grid-row: 2;
  position: sticky;
  top: var(--ctg-sticky-top, 8px);
  max-height: calc(100vh - var(--ctg-sticky-top, 8px) - 8px);
  overflow: auto;
}
#files_bucket[${OPEN_ATTR}] #diff > #files { grid-column: 2; grid-row: 2; min-width: 0; }
#files_bucket[${OPEN_ATTR}] > .container-xl,
div.container-xl:has(> #files_bucket[${OPEN_ATTR}]) { max-width: none; }
${HOST_TAG} { display: block; }
`;

/** Add the page-level layout rules once. They only take effect while the open attribute is set. */
export function ensurePageStyle(doc: Document = document): void {
  if (doc.getElementById(PAGE_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = PAGE_STYLE_ID;
  style.textContent = PAGE_CSS;
  doc.head.appendChild(style);
}

export function applyLayout(bucket: HTMLElement, open: boolean): void {
  ensurePageStyle(bucket.ownerDocument);
  bucket.toggleAttribute(OPEN_ATTR, open);
}

export function removeLayout(bucket: HTMLElement): void {
  bucket.removeAttribute(OPEN_ATTR);
}

export function setStickyTop(bucket: HTMLElement, px: number): void {
  bucket.style.setProperty('--ctg-sticky-top', `${px}px`);
}

/** Drop sidebar hosts left behind by Turbo's page cache before mounting a fresh one. */
export function removeStaleHosts(doc: Document = document): void {
  doc.querySelectorAll(HOST_TAG).forEach((host) => host.remove());
}

/** Height of any sticky or fixed header pinned to the top, plus the default gap. */
export function measureStickyTop(doc: Document = document, win: Window = window): number {
  let top = DEFAULT_STICKY_TOP;
  doc.querySelectorAll<HTMLElement>('header, .js-sticky, [class*="sticky"]').forEach((el) => {
    const style = win.getComputedStyle(el);
    if (
      (style.position === 'sticky' || style.position === 'fixed') &&
      parseFloat(style.top) === 0
    ) {
      top = Math.max(top, el.getBoundingClientRect().height + DEFAULT_STICKY_TOP);
    }
  });
  return top;
}

export interface ScrollOptions {
  files: Element;
  signal?: AbortSignal;
  timeoutMs?: number;
  stickyTop?: number;
  doc?: Document;
  win?: Window;
}

/** Scroll the diff for `path` under the sticky offset and put its anchor in the URL hash. */
export async function scrollToFile(path: string, options: ScrollOptions): Promise<boolean> {
  const {
    files,
    signal,
    timeoutMs = 20_000,
    stickyTop = DEFAULT_STICKY_TOP,
    doc = document,
    win = window,
  } = options;
  const anchor = await anchorFor(path);
  const target = await waitForId(anchor, files, doc, timeoutMs, signal);
  if (!target) return false;
  const top = target.getBoundingClientRect().top + win.scrollY - stickyTop;
  win.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  win.history.replaceState(null, '', `#${anchor}`);
  return true;
}

function waitForId(
  id: string,
  root: Element,
  doc: Document,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<HTMLElement | null> {
  const now = doc.getElementById(id);
  if (now) return Promise.resolve(now);
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(check);
    function done(el: HTMLElement | null): void {
      observer.disconnect();
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(el);
    }
    function onAbort(): void {
      done(null);
    }
    function check(): void {
      const found = doc.getElementById(id);
      if (found) done(found);
    }
    observer.observe(root, { childList: true, subtree: true });
    timer = setTimeout(() => done(null), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** The parts of `window` the active-file observer needs; a bare `Window` type does not expose the constructor. */
type ObserverWindow = Pick<Window, 'setTimeout'> & {
  IntersectionObserver?: typeof IntersectionObserver;
};

/**
 * Report which file header sits nearest the top of the viewport. The zone is the top 20% of
 * the viewport; when it holds no header (the reader is inside a long diff) the last file stays
 * active. Headers streamed in later are picked up automatically.
 */
export function observeActiveFile(
  files: Element,
  onChange: (path: string | null) => void,
  win: ObserverWindow = window,
): () => void {
  const Observer = win.IntersectionObserver;
  if (typeof Observer !== 'function') return () => {};
  const inZone = new Map<Element, number>();
  let current: string | null = null;
  const io = new Observer(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inZone.set(entry.target, entry.boundingClientRect.top);
        else inZone.delete(entry.target);
      }
      let best: Element | null = null;
      let bestTop = Infinity;
      for (const [el, top] of inZone) {
        if (top < bestTop) {
          best = el;
          bestTop = top;
        }
      }
      if (!best) return;
      const path = (best as HTMLElement).dataset.path ?? null;
      if (path !== current) {
        current = path;
        onChange(path);
      }
    },
    { rootMargin: '0px 0px -80% 0px', threshold: 0 },
  );
  const observeHeaders = (): void => {
    files.querySelectorAll(SELECTORS.fileHeader).forEach((header) => io.observe(header));
  };
  observeHeaders();
  let scheduled = false;
  const mutations = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    win.setTimeout(() => {
      scheduled = false;
      observeHeaders();
    }, 100);
  });
  mutations.observe(files, { childList: true, subtree: true });
  return () => {
    io.disconnect();
    mutations.disconnect();
  };
}
