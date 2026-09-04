// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSidebar, formatBytes, type Sidebar } from '../src/lib/render';
import { buildTree } from '../src/lib/tree';
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
    expect(labels).toEqual(['docs', 'new.md', 'src', 'app', 'main.ts', 'util.ts', 'old.ts', 'logo.png']);
    expect(rowFor('src').style.getPropertyValue('--ctg-depth')).toBe('0');
    expect(rowFor('src/app/main.ts').style.getPropertyValue('--ctg-depth')).toBe('2');
  });

  it('shows totals in the header', () => {
    expect(container.querySelector('.ctg-totals')?.textContent).toBe('5 files +5 −11');
  });

  it('uses a status icon per change kind', () => {
    expect(rowFor('src/app/util.ts').querySelector('.ctg-icon-added')).not.toBeNull();
    expect(rowFor('src/old.ts').querySelector('.ctg-icon-removed')).not.toBeNull();
    expect(rowFor('docs/new.md').querySelector('.ctg-icon-renamed')).not.toBeNull();
    expect(rowFor('src/app/main.ts').querySelector('.ctg-icon-modified')).not.toBeNull();
  });

  it('re-renders cleanly when a new tree arrives', () => {
    sidebar.setTree(buildTree([change('only.ts', 1, 0)]));
    expect(rows()).toHaveLength(1);
    expect(container.querySelector('.ctg-totals')?.textContent).toBe('1 file +1 −0');
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
      Array.from(container.querySelectorAll('.ctg-dir')).map((d) => d.getAttribute('aria-expanded'));
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
    expect(panel.hidden).toBe(false);
    expect(bar.hidden).toBe(true);
    container.querySelector<HTMLButtonElement>('.ctg-close')!.click();
    expect(onToggle).toHaveBeenLastCalledWith(false);
    sidebar.setOpen(false);
    expect(panel.hidden).toBe(true);
    expect(bar.hidden).toBe(false);
    container.querySelector<HTMLButtonElement>('.ctg-show')!.click();
    expect(onToggle).toHaveBeenLastCalledWith(true);
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
