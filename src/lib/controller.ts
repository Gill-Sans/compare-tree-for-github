import { createDiffParser } from './diff-parser';
import {
  SELECTORS,
  SIDEBAR_WIDTH,
  applyLayout,
  clampSidebarWidth,
  compareKey,
  diffUrl,
  findDiffRoot,
  measureStickyTop,
  observeActiveFile,
  parseCompareUrl,
  readTabFileCount,
  removeLayout,
  removeStaleHosts,
  scrollToFile,
  setSidebarWidth,
  setStickyTop,
  sidebarWidthBounds,
  waitFor,
  type CompareParts,
} from './page';
import type { Prefs } from './prefs';
import type { Sidebar } from './render';
import { buildTree, compactTree } from './tree';

export interface MountedSidebar {
  sidebar: Sidebar;
  unmount(): void;
}

export interface ControllerDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  prefs: Prefs;
  /** Create the sidebar UI immediately before `anchor` (GitHub's `#files` element). */
  mount: (anchor: Element) => Promise<MountedSidebar>;
  doc?: Document;
  win?: Window;
  version?: string;
  log?: (message: string, error?: unknown) => void;
  waitTimeoutMs?: number;
}

export interface Controller {
  /** Bring the page in line with `url`: mount, remount, or unmount as needed. Never throws. */
  sync(url: string): Promise<void>;
  dispose(): void;
  readonly key: string | null;
}

interface Session {
  key: string;
  parts: CompareParts;
  abort: AbortController;
  bucket: HTMLElement | null;
  mounted: MountedSidebar | null;
  stopObserver: (() => void) | null;
}

const ACCESS_MESSAGE =
  'GitHub did not return a diff. Are you signed in with access to this repository?';
const NETWORK_MESSAGE = 'Could not load the diff. Check your connection and retry.';

export function createController(deps: ControllerDeps): Controller {
  const doc = deps.doc ?? document;
  const win = deps.win ?? window;
  const log =
    deps.log ??
    ((message: string, error?: unknown) =>
      console.warn(`[compare-tree ${deps.version ?? 'dev'}] ${message}`, error ?? ''));
  let session: Session | null = null;

  function teardown(): void {
    const current = session;
    if (!current) return;
    session = null;
    current.abort.abort();
    current.stopObserver?.();
    current.mounted?.unmount();
    if (current.bucket) removeLayout(current.bucket);
  }

  async function load(s: Session): Promise<void> {
    const mounted = s.mounted;
    if (!mounted) return;
    const { sidebar } = mounted;
    const expectedFiles = readTabFileCount(doc);
    sidebar.setState({ kind: 'loading', expectedFiles, bytes: 0 });
    try {
      const response = await deps.fetch(diffUrl(s.parts, win.location.origin), {
        credentials: 'same-origin',
        signal: s.abort.signal,
      });
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !type.startsWith('text/plain') || !response.body) {
        const accessProblem = response.status === 404 || type.includes('text/html');
        sidebar.setState({
          kind: 'error',
          message: accessProblem
            ? ACCESS_MESSAGE
            : `GitHub returned ${response.status} for the diff.`,
        });
        return;
      }

      const parser = createDiffParser();
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        parser.push(decoder.decode(value, { stream: true }));
        sidebar.setState({ kind: 'loading', expectedFiles, bytes });
      }
      parser.push(decoder.decode());
      const summary = parser.end();
      if (s.abort.signal.aborted || session !== s) return;

      sidebar.setTree(compactTree(buildTree(summary.files)));
      const parsed = summary.files.length;
      if (expectedFiles !== null && expectedFiles !== parsed) {
        sidebar.setState({
          kind: 'ready',
          warning: `GitHub reports ${expectedFiles.toLocaleString('en-US')} files, the diff contained ${parsed.toLocaleString('en-US')}.`,
        });
      } else {
        sidebar.setState({ kind: 'ready' });
      }
    } catch (error) {
      if (s.abort.signal.aborted) return;
      log('Failed to load the compare diff', error);
      sidebar.setState({ kind: 'error', message: NETWORK_MESSAGE });
    }
  }

  async function start(parts: CompareParts, key: string): Promise<void> {
    const s: Session = {
      key,
      parts,
      abort: new AbortController(),
      bucket: null,
      mounted: null,
      stopObserver: null,
    };
    session = s;
    let ready = false;
    try {
      ready = await setUp(s);
    } catch (error) {
      if (!s.abort.signal.aborted) log('Failed to set up the compare tree', error);
    }
    // A session that never reached the loaded state must not linger: it would make `key`
    // claim a sidebar that does not exist and block a retry on the same URL.
    if (!ready && session === s) teardown();
  }

  /** Wait for GitHub's file list, mount and wire the sidebar, then load. False when nothing is showing. */
  async function setUp(s: Session): Promise<boolean> {
    try {
      await waitFor(SELECTORS.files, {
        timeoutMs: deps.waitTimeoutMs ?? 15_000,
        signal: s.abort.signal,
        doc,
      });
    } catch (error) {
      if (!s.abort.signal.aborted) {
        log('The compare file list did not appear; GitHub markup may have changed', error);
      }
      return false;
    }
    if (session !== s) return false;

    const root = findDiffRoot(doc);
    if (!root) {
      log('The compare diff container was not found; GitHub markup may have changed');
      return false;
    }
    removeStaleHosts(doc);
    s.bucket = root.bucket;
    setStickyTop(root.bucket, measureStickyTop(doc, win));

    const mounted = await deps.mount(root.files);
    if (session !== s) {
      mounted.unmount();
      return false;
    }
    s.mounted = mounted;
    const { sidebar } = mounted;

    const [open, width] = await Promise.all([
      deps.prefs.getSidebarOpen(),
      deps.prefs.getSidebarWidth(),
    ]);
    if (session !== s) return false;

    const applyWidth = (requested: number, commit: boolean): void => {
      const bounds = sidebarWidthBounds(root.diff.clientWidth);
      const applied = clampSidebarWidth(requested, bounds);
      setSidebarWidth(root.bucket, applied);
      sidebar.setWidth(applied, { ...bounds, reset: SIDEBAR_WIDTH.default });
      if (commit) {
        deps.prefs
          .setSidebarWidth(applied)
          .catch((error: unknown) => log('Failed to save the sidebar width', error));
      }
    };
    // The stored width is applied, never re-saved on load: with a 0-width hidden container the
    // bounds stay open so a stored width is not clamped down just because #diff isn't laid out yet.
    applyWidth(width, false);
    applyLayout(root.bucket, open);
    sidebar.setOpen(open);

    sidebar.onToggleOpen((next) => {
      applyLayout(root.bucket, next);
      sidebar.setOpen(next);
      deps.prefs
        .setSidebarOpen(next)
        .catch((error: unknown) => log('Failed to save the sidebar preference', error));
    });
    sidebar.onResize(applyWidth);
    sidebar.onSelectFile((path) =>
      scrollToFile(path, {
        files: root.files,
        signal: s.abort.signal,
        stickyTop: measureStickyTop(doc, win),
        doc,
        win,
      }),
    );
    sidebar.onRetry(() => {
      void load(s);
    });
    s.stopObserver = observeActiveFile(root.files, (path) => sidebar.setActive(path), win);

    await load(s);
    return true;
  }

  return {
    get key() {
      return session?.key ?? null;
    },
    async sync(url) {
      try {
        const parts = parseCompareUrl(url);
        if (!parts) {
          teardown();
          return;
        }
        const key = compareKey(parts);
        if (session?.key === key) {
          // Same compare, but Turbo may have swapped the page body under us: the sidebar left
          // with the old body while the URL never changed again. A session whose bucket is no
          // longer in the document is stale and must start over; otherwise this is a no-op.
          if (!session.bucket || session.bucket.isConnected) return;
        }
        teardown();
        await start(parts, key);
      } catch (error) {
        log('Unexpected error while syncing the compare tree', error);
      }
    },
    dispose() {
      try {
        teardown();
      } catch (error) {
        log('Failed to tear down the compare tree', error);
      }
    },
  };
}
