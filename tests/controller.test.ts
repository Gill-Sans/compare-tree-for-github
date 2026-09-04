// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createController, type Controller, type MountedSidebar } from '../src/lib/controller';
import { HOST_TAG, OPEN_ATTR, PAGE_STYLE_ID } from '../src/lib/page';
import type { Prefs } from '../src/lib/prefs';
import type { Sidebar } from '../src/lib/render';
import type { DirNode, SidebarState } from '../src/lib/types';
import { installComparePage } from './helpers/page-dom';

const EDGE = readFileSync(new NodeURL('./fixtures/edge-cases.diff', import.meta.url), 'utf8');
const URL_A = 'https://github.com/o/r/compare/main...feature/a';
const URL_B = 'https://github.com/o/r/compare/main...feature/b';

function textResponse(
  text: string,
  init: { status?: number; type?: string; chunkSize?: number } = {},
): Response {
  const { status = 200, type = 'text/plain; charset=utf-8', chunkSize = 64 } = init;
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return new Response(stream, { status, headers: { 'content-type': type } });
}

interface Spy {
  sidebar: Sidebar;
  states: SidebarState[];
  trees: DirNode[];
  open: boolean[];
  active: Array<string | null>;
  toggle: ((open: boolean) => void) | null;
  select: ((path: string) => Promise<boolean>) | null;
  retry: (() => void) | null;
  unmounted: boolean;
}

function spySidebar(): Spy {
  const spy = {
    states: [],
    trees: [],
    open: [],
    active: [],
    toggle: null,
    select: null,
    retry: null,
    unmounted: false,
  } as unknown as Spy;
  spy.sidebar = {
    setOpen: (open) => void spy.open.push(open),
    setState: (state) => void spy.states.push(state),
    setTree: (tree) => void spy.trees.push(tree),
    setActive: (path) => void spy.active.push(path),
    onToggleOpen: (cb) => void (spy.toggle = cb),
    onSelectFile: (cb) => void (spy.select = cb),
    onRetry: (cb) => void (spy.retry = cb),
  };
  return spy;
}

function memoryPrefs(initial = true): Prefs & { value: boolean } {
  const store = {
    value: initial,
    getSidebarOpen: async () => store.value,
    setSidebarOpen: async (open: boolean) => {
      store.value = open;
    },
  };
  return store;
}

let spies: Spy[];
let fetchMock: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;
let controller: Controller | null;

function makeController(
  prefs: Prefs = memoryPrefs(),
  respond?: () => Response,
  log: ReturnType<typeof vi.fn<(message: string, error?: unknown) => void>> = vi.fn(),
): Controller {
  fetchMock = vi.fn(async () => (respond ?? (() => textResponse(EDGE)))());
  return createController({
    fetch: (url) => fetchMock(url),
    prefs,
    mount: async (anchor) => {
      const spy = spySidebar();
      spies.push(spy);
      const host = document.createElement(HOST_TAG);
      anchor.parentElement!.insertBefore(host, anchor);
      const mounted: MountedSidebar = {
        sidebar: spy.sidebar,
        unmount: () => {
          spy.unmounted = true;
          host.remove();
        },
      };
      return mounted;
    },
    doc: document,
    win: window,
    log,
    waitTimeoutMs: 200,
  });
}

beforeEach(() => {
  spies = [];
  controller = null;
});

afterEach(() => {
  controller?.dispose();
  document.body.innerHTML = '';
  document.getElementById(PAGE_STYLE_ID)?.remove();
});

describe('controller happy path', () => {
  it('mounts, streams the diff, renders the tree, and applies the layout', async () => {
    const { bucket, files } = installComparePage(document, { tabCount: 13 });
    controller = makeController();
    await controller.sync(URL_A);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${window.location.origin}/o/r/compare/main...feature/a.diff`,
    );
    expect(spies).toHaveLength(1);
    const spy = spies[0]!;
    expect(files.previousElementSibling?.tagName.toLowerCase()).toBe(HOST_TAG);
    expect(spy.open).toEqual([true]);
    expect(bucket.hasAttribute(OPEN_ATTR)).toBe(true);
    expect(spy.states[0]).toEqual({ kind: 'loading', expectedFiles: 13, bytes: 0 });
    expect(spy.states.some((s) => s.kind === 'loading' && s.bytes > 0)).toBe(true);
    expect(spy.states.at(-1)).toEqual({ kind: 'ready' });
    expect(spy.trees).toHaveLength(1);
    expect(spy.trees[0]).toMatchObject({ files: 13, additions: 8, deletions: 6 });
    expect(controller.key).toBe('o/r/main...feature/a');
  });

  it('warns when the tab count disagrees with the diff', async () => {
    installComparePage(document, { tabCount: 29 });
    controller = makeController();
    await controller.sync(URL_A);
    expect(spies[0]!.states.at(-1)).toEqual({
      kind: 'ready',
      warning: 'GitHub reports 29 files, the diff contained 13.',
    });
  });

  it('respects a closed preference and persists toggles', async () => {
    const { bucket } = installComparePage(document, { tabCount: 13 });
    const prefs = memoryPrefs(false);
    controller = makeController(prefs);
    await controller.sync(URL_A);
    expect(spies[0]!.open).toEqual([false]);
    expect(bucket.hasAttribute(OPEN_ATTR)).toBe(false);

    spies[0]!.toggle!(true);
    expect(bucket.hasAttribute(OPEN_ATTR)).toBe(true);
    expect(spies[0]!.open).toEqual([false, true]);
    await vi.waitFor(() => expect(prefs.value).toBe(true));
  });

  it('routes file selection through the page adapter', async () => {
    installComparePage(document, { tabCount: 13 });
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    controller = makeController();
    await controller.sync(URL_A);
    // The diff for this path never streams in, so the jump must still be pending after 50 ms;
    // the eventual false after the 20 s wait is covered by the scrollToFile timeout test in page-dom.test.ts.
    await expect(
      Promise.race([
        spies[0]!.select!('never/streamed.ts'),
        new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 50)),
      ]),
    ).resolves.toBe('pending');
  });

  it('logs instead of throwing when saving the preference fails', async () => {
    installComparePage(document, { tabCount: 13 });
    const prefs = memoryPrefs();
    prefs.setSidebarOpen = async () => {
      throw new Error('storage gone');
    };
    const log = vi.fn();
    controller = makeController(prefs, undefined, log);
    await controller.sync(URL_A);
    spies[0]!.toggle!(false);
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith('Failed to save the sidebar preference', expect.any(Error)),
    );
  });
});

describe('controller navigation', () => {
  it('ignores a sync for the same compare', async () => {
    installComparePage(document, { tabCount: 13 });
    controller = makeController();
    await controller.sync(URL_A);
    await controller.sync(`${URL_A}#files_bucket`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spies).toHaveLength(1);
  });

  it('remounts when the page body is replaced under the same URL (Turbo render)', async () => {
    installComparePage(document, { tabCount: 13 });
    controller = makeController();
    await controller.sync(URL_A);
    expect(spies).toHaveLength(1);

    // Turbo swaps the body after the URL already changed: the old bucket leaves the document.
    installComparePage(document, { tabCount: 13 });
    await controller.sync(URL_A);
    expect(spies[0]!.unmounted).toBe(true);
    expect(spies).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1);
    expect(document.getElementById('files_bucket')!.hasAttribute(OPEN_ATTR)).toBe(true);
  });

  it('remounts for a different compare and removes the old sidebar', async () => {
    installComparePage(document, { tabCount: 13 });
    controller = makeController();
    await controller.sync(URL_A);
    await controller.sync(URL_B);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(spies[0]!.unmounted).toBe(true);
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1);
    expect(controller.key).toBe('o/r/main...feature/b');
  });

  it('unmounts when leaving compare pages', async () => {
    const { bucket } = installComparePage(document, { tabCount: 13 });
    controller = makeController();
    await controller.sync(URL_A);
    await controller.sync('https://github.com/o/r/pulls');
    expect(spies[0]!.unmounted).toBe(true);
    expect(bucket.hasAttribute(OPEN_ATTR)).toBe(false);
    expect(controller.key).toBeNull();
  });

  it('replaces a stale host left by the page cache', async () => {
    installComparePage(document, { tabCount: 13 });
    document.getElementById('diff')!.prepend(document.createElement(HOST_TAG));
    controller = makeController();
    await controller.sync(URL_A);
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1);
  });

  it('gives up quietly when the file list never appears', async () => {
    document.body.innerHTML = '<div id="nothing"></div>';
    controller = makeController();
    await controller.sync(URL_A);
    expect(spies).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(controller.key).toBeNull();
  });

  it('retries the same compare after giving up, once the file list exists', async () => {
    document.body.innerHTML = '<div id="nothing"></div>';
    controller = makeController();
    await controller.sync(URL_A);
    expect(controller.key).toBeNull();

    installComparePage(document, { tabCount: 13 });
    await controller.sync(URL_A);
    expect(spies).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(controller.key).toBe('o/r/main...feature/a');
  });

  it('tears down and logs when mounting throws, so the next sync can retry', async () => {
    installComparePage(document, { tabCount: 13 });
    const log = vi.fn();
    // Simulate a mount failure on the first attempt by pre-inserting a poison: the fake mount
    // used by makeController cannot be made to throw, so build a controller with its own mount.
    let attempts = 0;
    fetchMock = vi.fn(async () => textResponse(EDGE));
    controller = createController({
      fetch: (url) => fetchMock(url),
      prefs: memoryPrefs(),
      mount: async (anchor) => {
        attempts += 1;
        if (attempts === 1) throw new Error('mount exploded');
        const spy = spySidebar();
        spies.push(spy);
        const host = document.createElement(HOST_TAG);
        anchor.parentElement!.insertBefore(host, anchor);
        return { sidebar: spy.sidebar, unmount: () => host.remove() };
      },
      doc: document,
      win: window,
      log,
      waitTimeoutMs: 200,
    });
    await controller.sync(URL_A);
    expect(log).toHaveBeenCalledWith('Failed to set up the compare tree', expect.any(Error));
    expect(controller.key).toBeNull();
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(0);

    await controller.sync(URL_A);
    expect(spies).toHaveLength(1);
    expect(controller.key).toBe('o/r/main...feature/a');
  });
});

describe('controller errors', () => {
  it('shows an access error for an HTML response and retries on demand', async () => {
    installComparePage(document, { tabCount: 13 });
    let calls = 0;
    controller = makeController(memoryPrefs(), () =>
      calls++ === 0
        ? textResponse('<html>sign in</html>', { type: 'text/html; charset=utf-8' })
        : textResponse(EDGE),
    );
    await controller.sync(URL_A);
    const spy = spies[0]!;
    expect(spy.states.at(-1)).toEqual({
      kind: 'error',
      message: 'GitHub did not return a diff. Are you signed in with access to this repository?',
    });

    spy.retry!();
    await vi.waitFor(() => expect(spy.states.at(-1)).toEqual({ kind: 'ready' }));
    expect(spy.trees).toHaveLength(1);
  });

  it('shows a status error for a failed response', async () => {
    installComparePage(document, { tabCount: 13 });
    controller = makeController(memoryPrefs(), () => textResponse('nope', { status: 500 }));
    await controller.sync(URL_A);
    expect(spies[0]!.states.at(-1)).toEqual({
      kind: 'error',
      message: 'GitHub returned 500 for the diff.',
    });
  });

  it('shows a generic error when fetch throws', async () => {
    installComparePage(document, { tabCount: 13 });
    controller = makeController(memoryPrefs(), () => {
      throw new TypeError('Failed to fetch');
    });
    await controller.sync(URL_A);
    expect(spies[0]!.states.at(-1)).toEqual({
      kind: 'error',
      message: 'Could not load the diff. Check your connection and retry.',
    });
  });
});
