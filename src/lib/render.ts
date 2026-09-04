import { ICONS } from './icons';
import type { DirNode, FileNode, FileStatus, SidebarState, TreeNode } from './types';

export interface Sidebar {
  /** Show the full panel (true) or only the slim "Show file tree" bar (false). */
  setOpen(open: boolean): void;
  setState(state: SidebarState): void;
  /** Render a whole tree; every directory starts expanded. */
  setTree(root: DirNode): void;
  /** Highlight the file whose diff is at the top of the viewport. */
  setActive(path: string | null): void;
  onToggleOpen(cb: (open: boolean) => void): void;
  /** The callback resolves once the jump finished; the row shows a spinner until then. */
  onSelectFile(cb: (path: string) => Promise<boolean>): void;
  onRetry(cb: () => void): void;
}

const MINUS = '−';
const ARROW = '→';

const STATUS_CLASS: Record<FileStatus, string> = {
  added: 'ctg-icon-added',
  modified: 'ctg-icon-modified',
  removed: 'ctg-icon-removed',
  renamed: 'ctg-icon-renamed',
  copied: 'ctg-icon-copied',
};

export function createSidebar(container: HTMLElement): Sidebar {
  const doc = container.ownerDocument;
  container.classList.add('ctg-root');
  container.innerHTML = `
    <div class="ctg-bar">
      <button type="button" class="ctg-btn ctg-show" title="Show file tree">${ICONS.sidebarExpand}<span>Show file tree</span></button>
    </div>
    <section class="ctg-panel" aria-label="Changed files">
      <header class="ctg-header">
        <div class="ctg-title-row">
          <h2 class="ctg-title">Files changed</h2>
          <span class="ctg-totals"></span>
          <button type="button" class="ctg-icon-btn ctg-close" title="Hide file tree" aria-label="Hide file tree">${ICONS.sidebarCollapse}</button>
        </div>
        <div class="ctg-actions">
          <button type="button" class="ctg-btn ctg-collapse-all">${ICONS.fold}<span>Collapse all</span></button>
          <button type="button" class="ctg-btn ctg-expand-all">${ICONS.unfold}<span>Expand all</span></button>
        </div>
        <div class="ctg-status" role="status" aria-live="polite"></div>
      </header>
      <ul class="ctg-tree" role="tree" aria-label="Changed files"></ul>
    </section>`;

  const query = <T extends HTMLElement>(selector: string): T => {
    const el = container.querySelector<T>(selector);
    if (!el) throw new Error(`sidebar template is missing ${selector}`);
    return el;
  };
  const bar = query('.ctg-bar');
  const panel = query('.ctg-panel');
  const totals = query('.ctg-totals');
  const status = query('.ctg-status');
  const tree = query<HTMLUListElement>('.ctg-tree');

  let toggleCb: ((open: boolean) => void) | null = null;
  let selectCb: ((path: string) => Promise<boolean>) | null = null;
  let retryCb: (() => void) | null = null;
  const rowsByPath = new Map<string, HTMLButtonElement>();
  let activeRow: HTMLButtonElement | null = null;

  query('.ctg-show').addEventListener('click', () => toggleCb?.(true));
  query('.ctg-close').addEventListener('click', () => toggleCb?.(false));
  query('.ctg-collapse-all').addEventListener('click', () => setAllExpanded(false));
  query('.ctg-expand-all').addEventListener('click', () => setAllExpanded(true));

  function setAllExpanded(expanded: boolean): void {
    tree
      .querySelectorAll('.ctg-dir')
      .forEach((li) => li.setAttribute('aria-expanded', String(expanded)));
  }

  tree.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>('.ctg-row');
    const item = row?.parentElement;
    if (!row || !item || !tree.contains(row)) return;
    if (item.classList.contains('ctg-dir')) {
      item.setAttribute('aria-expanded', String(item.getAttribute('aria-expanded') !== 'true'));
      return;
    }
    const path = item.dataset.path;
    if (!path || !selectCb || row.classList.contains('ctg-busy')) return;
    row.classList.add('ctg-busy');
    selectCb(path)
      .catch(() => false)
      .finally(() => row.classList.remove('ctg-busy'));
  });

  tree.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>('.ctg-row');
    const item = row?.parentElement;
    if (!item?.classList.contains('ctg-dir')) return;
    item.setAttribute('aria-expanded', String(event.key === 'ArrowRight'));
    event.preventDefault();
  });

  function renderNode(node: TreeNode, depth: number): HTMLLIElement {
    return node.kind === 'dir' ? renderDir(node, depth) : renderFile(node, depth);
  }

  function renderDir(dir: DirNode, depth: number): HTMLLIElement {
    const li = doc.createElement('li');
    li.className = 'ctg-item ctg-dir';
    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-expanded', 'true');
    li.dataset.path = dir.path;

    const row = doc.createElement('button');
    row.type = 'button';
    row.className = 'ctg-row';
    row.style.setProperty('--ctg-depth', String(depth));
    row.title = dir.path;
    row.innerHTML =
      `<span class="ctg-chevron">${ICONS.chevronDown}</span>` +
      `<span class="ctg-icon ctg-icon-dir">${ICONS.folder}</span>` +
      `<span class="ctg-name"></span>` +
      `<span class="ctg-meta"><span class="ctg-count"></span><span class="ctg-add"></span><span class="ctg-del"></span></span>`;
    setText(row, '.ctg-name', dir.name);
    setText(row, '.ctg-count', `${dir.files} ${dir.files === 1 ? 'file' : 'files'}`);
    setText(row, '.ctg-add', `+${dir.additions}`);
    setText(row, '.ctg-del', `${MINUS}${dir.deletions}`);

    const group = doc.createElement('ul');
    group.className = 'ctg-group';
    group.setAttribute('role', 'group');
    for (const child of dir.children) group.appendChild(renderNode(child, depth + 1));

    li.append(row, group);
    return li;
  }

  function renderFile(file: FileNode, depth: number): HTMLLIElement {
    const li = doc.createElement('li');
    li.className = 'ctg-item ctg-file';
    li.setAttribute('role', 'treeitem');
    li.dataset.path = file.path;

    const change = file.change;
    const row = doc.createElement('button');
    row.type = 'button';
    row.className = 'ctg-row';
    row.style.setProperty('--ctg-depth', String(depth));
    row.title = change.oldPath ? `${change.oldPath} ${ARROW} ${change.path}` : change.path;
    const icon =
      change.status === 'added'
        ? ICONS.added
        : change.status === 'removed'
          ? ICONS.removed
          : change.status === 'renamed' || change.status === 'copied'
            ? ICONS.renamed
            : ICONS.modified;
    row.innerHTML =
      `<span class="ctg-icon">${icon}</span>` +
      `<span class="ctg-name"></span>` +
      `<span class="ctg-meta"></span>`;
    row.querySelector('.ctg-icon')?.classList.add(STATUS_CLASS[change.status]);
    setText(row, '.ctg-name', file.name);
    const meta = row.querySelector('.ctg-meta');
    if (meta) {
      if (change.binary) {
        meta.textContent = 'BIN';
      } else {
        meta.innerHTML = `<span class="ctg-add"></span><span class="ctg-del"></span>`;
        setText(meta, '.ctg-add', `+${change.additions}`);
        setText(meta, '.ctg-del', `${MINUS}${change.deletions}`);
      }
    }

    li.appendChild(row);
    rowsByPath.set(file.path, row);
    return li;
  }

  function renderStatus(state: SidebarState): void {
    status.className = 'ctg-status';
    status.replaceChildren();
    if (state.kind === 'loading') {
      const spinner = doc.createElement('span');
      spinner.className = 'ctg-spinner';
      const text = doc.createElement('span');
      const what =
        state.expectedFiles === null
          ? 'changed files'
          : `${state.expectedFiles.toLocaleString('en-US')} files`;
      text.textContent = `Loading ${what}… ${formatBytes(state.bytes)}`;
      status.append(spinner, text);
    } else if (state.kind === 'error') {
      status.classList.add('ctg-error');
      const text = doc.createElement('span');
      text.textContent = state.message;
      const retry = doc.createElement('button');
      retry.type = 'button';
      retry.className = 'ctg-btn ctg-retry';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => retryCb?.());
      status.append(text, retry);
    } else if (state.warning) {
      status.classList.add('ctg-warning');
      status.textContent = state.warning;
    }
  }

  return {
    setOpen(open) {
      container.toggleAttribute('data-open', open);
      bar.hidden = open;
      panel.hidden = !open;
    },
    setState(state) {
      renderStatus(state);
    },
    setTree(root) {
      rowsByPath.clear();
      activeRow = null;
      const fragment = doc.createDocumentFragment();
      for (const child of root.children) fragment.appendChild(renderNode(child, 0));
      tree.replaceChildren(fragment);

      const count = doc.createElement('span');
      count.textContent = `${root.files.toLocaleString('en-US')} ${root.files === 1 ? 'file' : 'files'}`;
      const add = doc.createElement('span');
      add.className = 'ctg-add';
      add.textContent = `+${root.additions.toLocaleString('en-US')}`;
      const del = doc.createElement('span');
      del.className = 'ctg-del';
      del.textContent = `${MINUS}${root.deletions.toLocaleString('en-US')}`;
      totals.replaceChildren(count, ' ', add, ' ', del);
    },
    setActive(path) {
      if (activeRow) {
        activeRow.classList.remove('ctg-active');
        activeRow.removeAttribute('aria-current');
      }
      activeRow = path === null ? null : (rowsByPath.get(path) ?? null);
      if (activeRow) {
        activeRow.classList.add('ctg-active');
        activeRow.setAttribute('aria-current', 'true');
        if (typeof activeRow.scrollIntoView === 'function') {
          activeRow.scrollIntoView({ block: 'nearest' });
        }
      }
    },
    onToggleOpen(cb) {
      toggleCb = cb;
    },
    onSelectFile(cb) {
      selectCb = cb;
    },
    onRetry(cb) {
      retryCb = cb;
    },
  };
}

function setText(root: ParentNode, selector: string, text: string): void {
  const el = root.querySelector(selector);
  if (el) el.textContent = text;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
