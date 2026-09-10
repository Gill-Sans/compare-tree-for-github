// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSidebar, formatBytes, type Sidebar } from '../src/lib/render';
import { buildTree, compactTree } from '../src/lib/tree';
import type { FileChange } from '../src/lib/types';

const change = (
  path: string,
  additions = 0,
  deletions = 0,
  extra: Partial<FileChange> = {},
): FileChange => ({ path, status: 'modified', additions, deletions, binary: false, ...extra });

const TREE = buildTree([
  change('src/app/main.ts', 4, 1),
  change('src/app/util.ts', 0, 0, { status: 'added' }),
  change('src/old.ts', 0, 9, { status: 'removed' }),
  change('docs/new.md', 1, 1, { status: 'renamed', oldPath: 'docs/old.md' }),
  change('logo.png', 0, 0, { binary: true }),
]);

// Three levels deep so a single toggle has more than one ancestor group to update.
const NESTED_TREE = buildTree([
  change('a/b/c/file1.ts'),
  change('a/b/c/file2.ts'),
  change('a/b/other.ts'),
]);

let container: HTMLElement;
let sidebar: Sidebar;

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  container = document.getElementById('host')!;
  sidebar = createSidebar(container);
  sidebar.setOpen(true);
  sidebar.setTree(TREE);
});

const rows = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.ctg-row'));
const item = (path: string) => container.querySelector<HTMLLIElement>(`li[data-path="${path}"]`)!;
const rowFor = (path: string) => item(path).querySelector<HTMLButtonElement>(':scope > .ctg-row')!;
const status = () => container.querySelector<HTMLElement>('.ctg-status')!;
const treeEl = () => container.querySelector<HTMLElement>('.ctg-tree')!;
const groupFor = (path: string) =>
  item(path).querySelector<HTMLUListElement>(':scope > .ctg-group')!;
const rowsOf = (path: string) => groupFor(path).style.getPropertyValue('--ctg-rows');

describe('createSidebar rendering', () => {
  it('renders a tree with roles, names, and counts', () => {
    expect(container.querySelector('[role="tree"]')).not.toBeNull();
    expect(item('src').getAttribute('role')).toBe('treeitem');
    expect(item('src').getAttribute('aria-expanded')).toBe('true');
    expect(item('src/app').querySelector('[role="group"]')).not.toBeNull();
    expect(rowFor('src').textContent).toContain('src');
    expect(rowFor('src').textContent).toContain('3 files');
    expect(rowFor('src').textContent).toContain('+4');
    expect(rowFor('src').textContent).toContain('−10');
    expect(rowFor('src/app/main.ts').textContent).toContain('main.ts');
    expect(rowFor('src/app/main.ts').textContent).toContain('+4');
    expect(rowFor('logo.png').textContent).toContain('BIN');
    expect(rowFor('docs/new.md').title).toBe('docs/old.md → docs/new.md');
    expect(rowFor('src/old.ts').title).toBe('src/old.ts');
  });

  it('orders directories before files and indents by depth', () => {
    const labels = rows().map((r) => r.querySelector('.ctg-name')?.textContent);
    expect(labels).toEqual([
      'docs',
      'new.md',
      'src',
      'app',
      'main.ts',
      'util.ts',
      'old.ts',
      'logo.png',
    ]);
    expect(rowFor('src').style.getPropertyValue('--ctg-depth')).toBe('0');
    expect(rowFor('src/app/main.ts').style.getPropertyValue('--ctg-depth')).toBe('2');
  });

  it('shows totals in the header', () => {
    expect(container.querySelector('.ctg-totals')?.textContent).toBe('5 files +5 −11');
  });

  it('uses a status icon per change kind', () => {
    expect(rowFor('src/app/util.ts').querySelector('.ctg-icon.ctg-icon-added')).not.toBeNull();
    expect(rowFor('src/old.ts').querySelector('.ctg-icon.ctg-icon-removed')).not.toBeNull();
    expect(rowFor('docs/new.md').querySelector('.ctg-icon.ctg-icon-renamed')).not.toBeNull();
    expect(rowFor('src/app/main.ts').querySelector('.ctg-icon.ctg-icon-modified')).not.toBeNull();
  });

  it('renders no <svg> in the tree and folder rows carry a toggle and a directory icon', () => {
    expect(container.querySelector('.ctg-tree svg')).toBeNull();
    expect(rowFor('src').querySelector('.ctg-toggle')).not.toBeNull();
    expect(rowFor('src').querySelector('.ctg-icon-dir')).not.toBeNull();
    expect(rowFor('docs').querySelector('.ctg-toggle')).not.toBeNull();
    expect(rowFor('docs').querySelector('.ctg-icon-dir')).not.toBeNull();
  });

  it('defines every tree glyph as a data: URL custom property on the container', () => {
    const props = [
      '--ctg-glyph-chevron',
      '--ctg-glyph-folder',
      '--ctg-glyph-folder-open',
      '--ctg-glyph-file-added',
      '--ctg-glyph-file-removed',
      '--ctg-glyph-file-diff',
      '--ctg-glyph-file-moved',
    ];
    for (const prop of props) {
      const value = container.style.getPropertyValue(prop);
      expect(value).toMatch(/^url\("data:image\/svg\+xml,/);
    }
  });

  it('re-renders cleanly when a new tree arrives', () => {
    sidebar.setTree(buildTree([change('only.ts', 1, 0)]));
    expect(rows()).toHaveLength(1);
    expect(container.querySelector('.ctg-totals')?.textContent).toBe('1 file +1 −0');
  });

  it('labels a folded folder chain with the joined path', () => {
    sidebar.setTree(
      compactTree(
        buildTree([change('src/main/java/App.java', 1, 0), change('src/main/java/Util.java')]),
      ),
    );
    expect(rows()).toHaveLength(3);
    expect(rowFor('src/main/java').querySelector('.ctg-name')?.textContent).toBe('src/main/java');
    expect(rowFor('src/main/java').title).toBe('src/main/java');
  });
});

describe('createSidebar interactions', () => {
  it('toggles a directory on click and via arrow keys', () => {
    rowFor('src').click();
    expect(item('src').getAttribute('aria-expanded')).toBe('false');
    rowFor('src').click();
    expect(item('src').getAttribute('aria-expanded')).toBe('true');
    rowFor('src').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(item('src').getAttribute('aria-expanded')).toBe('false');
    rowFor('src').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(item('src').getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses and expands everything from the header buttons', () => {
    const expandedStates = () =>
      Array.from(container.querySelectorAll('.ctg-dir')).map((d) =>
        d.getAttribute('aria-expanded'),
      );
    container.querySelector<HTMLButtonElement>('.ctg-collapse-all')!.click();
    expect(expandedStates()).toEqual(['false', 'false', 'false']);
    container.querySelector<HTMLButtonElement>('.ctg-expand-all')!.click();
    expect(expandedStates()).toEqual(['true', 'true', 'true']);
  });

  it('reports file clicks and shows a busy marker until the jump settles', async () => {
    let settle!: (ok: boolean) => void;
    const onSelect = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    );
    sidebar.onSelectFile(onSelect);
    rowFor('src/old.ts').click();
    expect(onSelect).toHaveBeenCalledWith('src/old.ts');
    expect(rowFor('src/old.ts').classList.contains('ctg-busy')).toBe(true);
    rowFor('src/old.ts').click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    settle(true);
    await vi.waitFor(() => expect(rowFor('src/old.ts').classList.contains('ctg-busy')).toBe(false));
  });

  it('highlights the active file', () => {
    sidebar.setActive('src/app/main.ts');
    expect(rowFor('src/app/main.ts').classList.contains('ctg-active')).toBe(true);
    expect(rowFor('src/app/main.ts').getAttribute('aria-current')).toBe('true');
    sidebar.setActive('logo.png');
    expect(rowFor('src/app/main.ts').classList.contains('ctg-active')).toBe(false);
    expect(rowFor('logo.png').classList.contains('ctg-active')).toBe(true);
    sidebar.setActive(null);
    expect(container.querySelector('.ctg-active')).toBeNull();
  });

  it('switches between the panel and the slim bar, reporting toggles', () => {
    const onToggle = vi.fn();
    sidebar.onToggleOpen(onToggle);
    const panel = container.querySelector<HTMLElement>('.ctg-panel')!;
    const bar = container.querySelector<HTMLElement>('.ctg-bar')!;
    const resizer = container.querySelector<HTMLElement>('.ctg-resizer')!;
    expect(panel.hidden).toBe(false);
    expect(bar.hidden).toBe(true);
    expect(resizer.hidden).toBe(false);
    container.querySelector<HTMLButtonElement>('.ctg-close')!.click();
    expect(onToggle).toHaveBeenLastCalledWith(false);
    sidebar.setOpen(false);
    expect(panel.hidden).toBe(true);
    expect(bar.hidden).toBe(false);
    expect(resizer.hidden).toBe(true);
    container.querySelector<HTMLButtonElement>('.ctg-show')!.click();
    expect(onToggle).toHaveBeenLastCalledWith(true);
  });
});

describe('createSidebar resizer', () => {
  const resizer = () => container.querySelector<HTMLElement>('.ctg-resizer')!;

  it('is a labelled, focusable separator', () => {
    const el = resizer();
    expect(el.getAttribute('role')).toBe('separator');
    expect(el.getAttribute('aria-orientation')).toBe('vertical');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.hidden).toBe(false);
  });

  it('reflects the applied width and bounds as aria attributes, omitting valuemax when unbounded', () => {
    sidebar.setWidth(320, { min: 240, max: 800, reset: 320 });
    const el = resizer();
    expect(el.getAttribute('aria-valuenow')).toBe('320');
    expect(el.getAttribute('aria-valuemin')).toBe('240');
    expect(el.getAttribute('aria-valuemax')).toBe('800');
    expect(el.getAttribute('aria-valuetext')).toBe('320 pixels');

    sidebar.setWidth(500, { min: 240, max: Number.POSITIVE_INFINITY, reset: 320 });
    expect(el.getAttribute('aria-valuemax')).toBeNull();
    expect(el.getAttribute('aria-valuetext')).toBe('500 pixels');
  });

  it('resizes with the keyboard: arrows step, Home/End jump to bounds, End is a no-op when unbounded', () => {
    const onResize = vi.fn();
    sidebar.onResize(onResize);
    sidebar.setWidth(320, { min: 240, max: 800, reset: 320 });
    const el = resizer();

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(onResize).toHaveBeenLastCalledWith(304, true);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(onResize).toHaveBeenLastCalledWith(336, true);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(onResize).toHaveBeenLastCalledWith(240, true);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(onResize).toHaveBeenLastCalledWith(800, true);
    expect(onResize).toHaveBeenCalledTimes(4);

    sidebar.setWidth(320, { min: 240, max: Number.POSITIVE_INFINITY, reset: 320 });
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(onResize).toHaveBeenCalledTimes(4);
  });

  it('resets to the given reset width on double-click', () => {
    const onResize = vi.fn();
    sidebar.onResize(onResize);
    sidebar.setWidth(500, { min: 240, max: 800, reset: 320 });
    resizer().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onResize).toHaveBeenCalledWith(320, true);
  });

  it('drags: coalesces move updates to one per frame and commits on pointerup', async () => {
    const onResize = vi.fn();
    sidebar.onResize(onResize);
    sidebar.setWidth(320, { min: 240, max: 800, reset: 320 });
    const el = resizer();

    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 100 }));
    expect(container.hasAttribute('data-resizing')).toBe(true);

    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 130 }));
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 150 }));
    expect(onResize).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onResize).toHaveBeenCalledWith(370, false));
    expect(onResize).toHaveBeenCalledTimes(1);

    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 150 }));
    expect(onResize).toHaveBeenLastCalledWith(370, true);
    expect(container.hasAttribute('data-resizing')).toBe(false);
  });

  it('ignores non-primary buttons', () => {
    const onResize = vi.fn();
    sidebar.onResize(onResize);
    sidebar.setWidth(320, { min: 240, max: 800, reset: 320 });
    resizer().dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 2, clientX: 100 }),
    );
    expect(container.hasAttribute('data-resizing')).toBe(false);
    resizer().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 200 }));
    expect(onResize).not.toHaveBeenCalled();
  });

  it('commits the last requested width when the drag is cancelled', async () => {
    const onResize = vi.fn();
    sidebar.onResize(onResize);
    sidebar.setWidth(320, { min: 240, max: 800, reset: 320 });
    const el = resizer();

    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 100 }));
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 140 }));
    await vi.waitFor(() => expect(onResize).toHaveBeenCalledWith(360, false));

    el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    expect(onResize).toHaveBeenLastCalledWith(360, true);
    expect(container.hasAttribute('data-resizing')).toBe(false);
  });

  it('commits the last requested width when pointer capture is lost', async () => {
    const onResize = vi.fn();
    sidebar.onResize(onResize);
    sidebar.setWidth(320, { min: 240, max: 800, reset: 320 });
    const el = resizer();

    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 100 }));
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 140 }));
    await vi.waitFor(() => expect(onResize).toHaveBeenCalledWith(360, false));

    el.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true }));
    expect(onResize).toHaveBeenLastCalledWith(360, true);
    expect(container.hasAttribute('data-resizing')).toBe(false);
  });
});

describe('createSidebar row counts', () => {
  it("mirrors each group's visible row count onto --ctg-rows after render", () => {
    expect(rowsOf('src/app')).toBe('2');
    expect(rowsOf('src')).toBe('4');
    expect(rowsOf('docs')).toBe('1');
  });

  it('propagates a delta to every ancestor group when a nested folder collapses or expands', () => {
    sidebar.setTree(NESTED_TREE);
    expect(rowsOf('a/b/c')).toBe('2');
    expect(rowsOf('a/b')).toBe('4');
    expect(rowsOf('a')).toBe('5');

    rowFor('a/b/c').click();
    expect(item('a/b/c').getAttribute('aria-expanded')).toBe('false');
    // Ancestors shrink by the collapsed folder's own row count (2)...
    expect(rowsOf('a/b')).toBe('2');
    expect(rowsOf('a')).toBe('3');
    // ...but the collapsed folder's own stored count is untouched.
    expect(rowsOf('a/b/c')).toBe('2');

    rowFor('a/b/c').click();
    expect(item('a/b/c').getAttribute('aria-expanded')).toBe('true');
    expect(rowsOf('a/b')).toBe('4');
    expect(rowsOf('a')).toBe('5');
  });

  it('leaves counts unchanged when ArrowRight is pressed on an already-expanded folder', () => {
    const before = rowsOf('src');
    rowFor('src').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(item('src').getAttribute('aria-expanded')).toBe('true');
    expect(rowsOf('src')).toBe(before);
  });

  it('recounts every group bottom-up after Collapse all / Expand all', () => {
    sidebar.setTree(NESTED_TREE);
    container.querySelector<HTMLButtonElement>('.ctg-collapse-all')!.click();
    expect(rowsOf('a/b/c')).toBe('2');
    expect(rowsOf('a/b')).toBe('2');
    expect(rowsOf('a')).toBe('1');

    container.querySelector<HTMLButtonElement>('.ctg-expand-all')!.click();
    expect(rowsOf('a/b/c')).toBe('2');
    expect(rowsOf('a/b')).toBe('4');
    expect(rowsOf('a')).toBe('5');
  });
});

describe('createSidebar large-tree switch', () => {
  it('is absent for a tree with 1,000 rows or fewer', () => {
    expect(treeEl().hasAttribute('data-large')).toBe(false);
  });

  it('is present once a tree has more than 1,000 rows', () => {
    const many = Array.from({ length: 1001 }, (_, i) => change(`file${i}.ts`));
    sidebar.setTree(buildTree(many));
    expect(treeEl().hasAttribute('data-large')).toBe(true);
  });
});

describe('createSidebar states', () => {
  it('shows loading progress', () => {
    sidebar.setState({ kind: 'loading', expectedFiles: 475, bytes: 1_300_000 });
    expect(status().textContent).toContain('Loading 475 files');
    expect(status().textContent).toContain('1.2 MB');
    expect(status().querySelector('.ctg-spinner')).not.toBeNull();
    sidebar.setState({ kind: 'loading', expectedFiles: null, bytes: 500 });
    expect(status().textContent).toContain('Loading changed files');
    expect(status().textContent).toContain('500 B');
  });

  it('shows errors with a retry button', () => {
    const onRetry = vi.fn();
    sidebar.onRetry(onRetry);
    sidebar.setState({ kind: 'error', message: 'Could not load the diff.' });
    expect(status().classList.contains('ctg-error')).toBe(true);
    expect(status().textContent).toContain('Could not load the diff.');
    status().querySelector<HTMLButtonElement>('.ctg-retry')!.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows warnings and clears the status when ready', () => {
    sidebar.setState({ kind: 'ready', warning: 'GitHub reports 30 files, the diff contained 29.' });
    expect(status().classList.contains('ctg-warning')).toBe(true);
    expect(status().textContent).toContain('30 files');
    sidebar.setState({ kind: 'ready' });
    expect(status().textContent).toBe('');
    expect(status().className).toBe('ctg-status');
  });
});

describe('formatBytes', () => {
  it('formats bytes, kilobytes, and megabytes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(46_408)).toBe('45 KB');
    expect(formatBytes(1_300_000)).toBe('1.2 MB');
  });
});
