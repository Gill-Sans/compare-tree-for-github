// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOST_TAG,
  OPEN_ATTR,
  PAGE_STYLE_ID,
  anchorFor,
  applyLayout,
  clampSidebarWidth,
  findDiffRoot,
  measureStickyTop,
  observeActiveFile,
  readTabFileCount,
  removeLayout,
  removeStaleHosts,
  scrollToFile,
  setSidebarWidth,
  sidebarWidthBounds,
  waitFor,
} from '../src/lib/page';
import { fileElement, installComparePage } from './helpers/page-dom';

afterEach(() => {
  document.body.innerHTML = '';
  document.getElementById(PAGE_STYLE_ID)?.remove();
});

describe('findDiffRoot and readTabFileCount', () => {
  it('finds the bucket, diff container, and file list', () => {
    const { bucket, files } = installComparePage(document, { tabCount: 29 });
    const root = findDiffRoot(document);
    expect(root?.bucket).toBe(bucket);
    expect(root?.files).toBe(files);
    expect(root?.diff.id).toBe('diff');
  });

  it('returns null when the file list is missing', () => {
    document.body.innerHTML = '<div id="files_bucket"></div>';
    expect(findDiffRoot(document)).toBeNull();
  });

  it('reads the tab count, including thousands separators', () => {
    installComparePage(document, { tabCount: '1,579' });
    expect(readTabFileCount(document)).toBe(1579);
  });

  it('returns null without a files tab', () => {
    expect(readTabFileCount(document)).toBeNull();
  });
});

describe('waitFor', () => {
  it('resolves immediately when the element exists', async () => {
    installComparePage(document);
    await expect(waitFor('#files', { doc: document })).resolves.toBe(
      document.getElementById('files'),
    );
  });

  it('resolves when the element appears later', async () => {
    document.body.innerHTML = '<div id="later-host"></div>';
    const pending = waitFor('#later', { doc: document, timeoutMs: 1000 });
    const el = document.createElement('div');
    el.id = 'later';
    document.getElementById('later-host')!.appendChild(el);
    await expect(pending).resolves.toBe(el);
  });

  it('rejects on timeout and on abort', async () => {
    await expect(waitFor('#never', { doc: document, timeoutMs: 20 })).rejects.toThrow(/Timed out/);
    const controller = new AbortController();
    const pending = waitFor('#never', {
      doc: document,
      timeoutMs: 1000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('layout', () => {
  it('injects the page style once and toggles the open attribute', () => {
    const { bucket } = installComparePage(document);
    applyLayout(bucket, true);
    applyLayout(bucket, true);
    expect(document.querySelectorAll(`#${PAGE_STYLE_ID}`)).toHaveLength(1);
    const css = document.getElementById(PAGE_STYLE_ID)?.textContent ?? '';
    expect(css).toContain(`[${OPEN_ATTR}]`);
    expect(css).toContain('clamp(240px, var(--ctg-sidebar-width, 320px), calc(100% - 496px))');
    expect(css).not.toContain('overflow');
    expect(css).not.toContain('max-height');
    expect(bucket.hasAttribute(OPEN_ATTR)).toBe(true);
    applyLayout(bucket, false);
    expect(bucket.hasAttribute(OPEN_ATTR)).toBe(false);
    applyLayout(bucket, true);
    removeLayout(bucket);
    expect(bucket.hasAttribute(OPEN_ATTR)).toBe(false);
  });

  it('removes stale host elements and measures a default sticky offset', () => {
    installComparePage(document);
    document.getElementById('diff')!.prepend(document.createElement(HOST_TAG));
    removeStaleHosts(document);
    expect(document.querySelector(HOST_TAG)).toBeNull();
    expect(measureStickyTop(document, window)).toBe(8);
  });
});

describe('sidebar width', () => {
  it('bounds the sidebar width against the diff width, keeping room for the diff column', () => {
    expect(sidebarWidthBounds(1248)).toEqual({ min: 240, max: 752 });
    // A narrow diff would push max below min; it clamps to min instead of inverting.
    expect(sidebarWidthBounds(600)).toEqual({ min: 240, max: 240 });
    // No layout yet (e.g. a hidden tab): stay unbounded rather than shrink a stored width.
    expect(sidebarWidthBounds(0)).toEqual({ min: 240, max: Number.POSITIVE_INFINITY });
  });

  it('clamps a requested width into bounds, rounding and falling back on non-finite input', () => {
    const bounds = { min: 240, max: 800 };
    expect(clampSidebarWidth(100, bounds)).toBe(240);
    expect(clampSidebarWidth(900, bounds)).toBe(800);
    expect(clampSidebarWidth(300.6, bounds)).toBe(301);
    expect(clampSidebarWidth(Number.NaN, bounds)).toBe(320);
  });

  it('writes the sidebar width css variable', () => {
    const { bucket } = installComparePage(document);
    setSidebarWidth(bucket, 400);
    expect(bucket.style.getPropertyValue('--ctg-sidebar-width')).toBe('400px');
  });
});

describe('scrollToFile', () => {
  it('scrolls to an existing diff and updates the hash', async () => {
    const path = 'src/index.ts';
    const anchor = await anchorFor(path);
    const { files, container } = installComparePage(document);
    container.appendChild(fileElement(document, path, anchor));
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    await expect(scrollToFile(path, { files, doc: document, win: window })).resolves.toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
    expect(window.location.hash).toBe(`#${anchor}`);
  });

  it('waits for a diff that streams in later', async () => {
    const path = 'late/file.ts';
    const anchor = await anchorFor(path);
    const { files, container } = installComparePage(document);
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    const pending = scrollToFile(path, { files, doc: document, win: window, timeoutMs: 1000 });
    container.appendChild(fileElement(document, path, anchor));
    await expect(pending).resolves.toBe(true);
  });

  it('gives up after the timeout', async () => {
    const { files } = installComparePage(document);
    await expect(
      scrollToFile('missing.ts', { files, doc: document, win: window, timeoutMs: 20 }),
    ).resolves.toBe(false);
  });
});

describe('observeActiveFile', () => {
  class FakeIntersectionObserver {
    static instances: FakeIntersectionObserver[] = [];
    observed = new Set<Element>();
    disconnected = false;
    constructor(public callback: IntersectionObserverCallback) {
      FakeIntersectionObserver.instances.push(this);
    }
    observe(el: Element): void {
      this.observed.add(el);
    }
    unobserve(el: Element): void {
      this.observed.delete(el);
    }
    disconnect(): void {
      this.disconnected = true;
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  const entry = (target: Element, top: number, isIntersecting = true) =>
    ({
      target,
      isIntersecting,
      boundingClientRect: { top },
    }) as unknown as IntersectionObserverEntry;

  it('reports the topmost header in the zone and keeps the last one when the zone empties', () => {
    const { files, container } = installComparePage(document, { paths: ['a.ts', 'b.ts'] });
    const win = {
      IntersectionObserver: FakeIntersectionObserver,
      setTimeout: window.setTimeout.bind(window),
    } as unknown as Window;
    const onChange = vi.fn();
    const stop = observeActiveFile(files, onChange, win);
    const io = FakeIntersectionObserver.instances.at(-1)!;
    const [a, b] = Array.from(container.querySelectorAll<HTMLElement>('.file-header'));
    if (!a || !b) throw new Error('expected two file headers');
    expect(io.observed.size).toBe(2);

    io.callback([entry(a, 40), entry(b, 10)], io as unknown as IntersectionObserver);
    expect(onChange).toHaveBeenLastCalledWith('b.ts');

    io.callback([entry(b, 10, false)], io as unknown as IntersectionObserver);
    expect(onChange).toHaveBeenLastCalledWith('a.ts');

    io.callback([entry(a, 40, false)], io as unknown as IntersectionObserver);
    expect(onChange).toHaveBeenCalledTimes(2);

    stop();
    expect(io.disconnected).toBe(true);
  });

  it('does nothing when IntersectionObserver is unavailable', () => {
    const { files } = installComparePage(document);
    const stop = observeActiveFile(files, vi.fn(), {} as Window);
    expect(typeof stop).toBe('function');
  });
});
