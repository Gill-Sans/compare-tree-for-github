import { glyphUrl, ICONS, type GlyphName } from './icons';
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
  /** Reflect the applied width on the divider; `reset` is what a double-click restores. */
  setWidth(width: number, bounds: { min: number; max: number; reset: number }): void;
  /** Width requests from the divider: repeatedly while dragging (commit false), once when a
   * drag, key press or double-click finishes (commit true). */
  onResize(cb: (width: number, commit: boolean) => void): void;
}

const MINUS = '−';
const ARROW = '→';

// Toggling a large folder open/closed costs style+layout proportional to its descendant rows
// (measured: ~100ms at 1x CPU, ~680ms at 4x CPU for a 3,800-row folder). content-visibility:auto
// on folder groups (see sidebar.css) cuts that to ~20ms by skipping off-screen rows, but it also
// adds ~5-15ms of overhead to a small toggle — so it's only switched on past this row count.
const LARGE_TREE_ROWS = 1000;

const STATUS_CLASS: Record<FileStatus, string> = {
  added: 'ctg-icon-added',
  modified: 'ctg-icon-modified',
  removed: 'ctg-icon-removed',
  renamed: 'ctg-icon-renamed',
  copied: 'ctg-icon-copied',
};

// Rows hold no <svg> of their own; each glyph is a CSS mask image referencing one of these
// custom properties, set once on the container so every row can share the same data: URIs.
const GLYPH_VARS: Record<string, GlyphName> = {
  '--ctg-glyph-chevron': 'chevron',
  '--ctg-glyph-folder': 'folder',
  '--ctg-glyph-folder-open': 'folderOpen',
  '--ctg-glyph-file-added': 'fileAdded',
  '--ctg-glyph-file-removed': 'fileRemoved',
  '--ctg-glyph-file-diff': 'fileDiff',
  '--ctg-glyph-file-moved': 'fileMoved',
};

const DIR_ROW_HTML =
  '<span class="ctg-glyph ctg-toggle"></span>' +
  '<span class="ctg-glyph ctg-icon ctg-icon-dir"></span>' +
  '<span class="ctg-name"></span>' +
  '<span class="ctg-meta"><span class="ctg-count"></span><span class="ctg-add"></span><span class="ctg-del"></span></span>';

const FILE_ROW_HTML =
  '<span class="ctg-glyph ctg-icon"></span>' +
  '<span class="ctg-name"></span>' +
  '<span class="ctg-meta"></span>';

export function createSidebar(container: HTMLElement): Sidebar {
  const doc = container.ownerDocument;
  container.classList.add('ctg-root');
  for (const [prop, name] of Object.entries(GLYPH_VARS)) {
    container.style.setProperty(prop, glyphUrl(name));
  }
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
    </section>
    <div class="ctg-resizer" role="separator" aria-orientation="vertical" aria-label="Resize file tree" tabindex="0"></div>`;

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
  const resizer = query('.ctg-resizer');

  let toggleCb: ((open: boolean) => void) | null = null;
  let selectCb: ((path: string) => Promise<boolean>) | null = null;
  let retryCb: (() => void) | null = null;
  let resizeCb: ((width: number, commit: boolean) => void) | null = null;
  const rowsByPath = new Map<string, HTMLButtonElement>();
  let activeRow: HTMLButtonElement | null = null;

  // How many rows each .ctg-group currently shows (its own children, plus the children of any
  // of those that are themselves expanded folders) — mirrored onto the group as --ctg-rows so
  // content-visibility:auto can reserve exactly that much space for an off-screen group.
  const rowCounts = new WeakMap<HTMLUListElement, number>();

  // Mirrors the last setWidth() call: a drag starts from the applied width, and Home/End/reset
  // need the current bounds.
  let currentWidth = 0;
  let currentBounds = { min: 0, max: Number.POSITIVE_INFINITY, reset: 0 };

  query('.ctg-show').addEventListener('click', () => toggleCb?.(true));
  query('.ctg-close').addEventListener('click', () => toggleCb?.(false));
  query('.ctg-collapse-all').addEventListener('click', () => setAllExpanded(false));
  query('.ctg-expand-all').addEventListener('click', () => setAllExpanded(true));

  function setAllExpanded(expanded: boolean): void {
    tree
      .querySelectorAll('.ctg-dir')
      .forEach((li) => li.setAttribute('aria-expanded', String(expanded)));
    recountAll();
  }

  /** The single path through which a folder's expanded state changes, so its row-count delta
   * always reaches every ancestor group. A no-op when the state doesn't actually change. */
  function setExpanded(item: HTMLElement, expanded: boolean): void {
    const wasExpanded = item.getAttribute('aria-expanded') === 'true';
    if (wasExpanded === expanded) return;
    item.setAttribute('aria-expanded', String(expanded));
    const group = item.querySelector<HTMLUListElement>(':scope > .ctg-group');
    if (!group) return;
    const ownRows = rowCounts.get(group) ?? 0;
    const delta = expanded ? ownRows : -ownRows;
    let ancestor = item.parentElement;
    while (ancestor?.classList.contains('ctg-group')) {
      const ancestorGroup = ancestor as HTMLUListElement;
      const updated = (rowCounts.get(ancestorGroup) ?? 0) + delta;
      rowCounts.set(ancestorGroup, updated);
      ancestorGroup.style.setProperty('--ctg-rows', String(updated));
      ancestor = ancestorGroup.parentElement?.parentElement ?? null;
    }
  }

  /** Recomputes every group's row count bottom-up from the DOM's current aria-expanded state.
   * Used after Collapse all / Expand all, which flip every folder in one pass rather than routing
   * each one through setExpanded. */
  function recountGroup(group: HTMLUListElement): number {
    let count = 0;
    for (const child of Array.from(group.children) as HTMLLIElement[]) {
      count += 1;
      if (child.classList.contains('ctg-dir')) {
        const childGroup = child.querySelector<HTMLUListElement>(':scope > .ctg-group');
        if (childGroup) {
          const childRows = recountGroup(childGroup);
          if (child.getAttribute('aria-expanded') === 'true') count += childRows;
        }
      }
    }
    rowCounts.set(group, count);
    group.style.setProperty('--ctg-rows', String(count));
    return count;
  }

  function recountAll(): void {
    for (const child of Array.from(tree.children) as HTMLLIElement[]) {
      if (child.classList.contains('ctg-dir')) {
        const group = child.querySelector<HTMLUListElement>(':scope > .ctg-group');
        if (group) recountGroup(group);
      }
    }
  }

  tree.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>('.ctg-row');
    const item = row?.parentElement;
    if (!row || !item || !tree.contains(row)) return;
    if (item.classList.contains('ctg-dir')) {
      setExpanded(item, item.getAttribute('aria-expanded') !== 'true');
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
    setExpanded(item, event.key === 'ArrowRight');
    event.preventDefault();
  });

  // Drag state for the divider. `requested` tracks the latest pointer position regardless of
  // whether a frame is pending, so pointercancel/lostpointercapture can commit it directly.
  let dragging = false;
  let dragPointerId: number | undefined;
  let startX = 0;
  let startWidth = 0;
  let requested = 0;
  let frame: { cancel: () => void } | null = null;

  function scheduleResize(): void {
    if (frame) return;
    const win = doc.defaultView;
    if (win && typeof win.requestAnimationFrame === 'function') {
      const id = win.requestAnimationFrame(fireResize);
      frame = { cancel: () => win.cancelAnimationFrame(id) };
    } else {
      const id = setTimeout(fireResize, 16);
      frame = { cancel: () => clearTimeout(id) };
    }
  }

  function fireResize(): void {
    frame = null;
    resizeCb?.(requested, false);
  }

  function cancelScheduledResize(): void {
    frame?.cancel();
    frame = null;
  }

  function endDrag(): void {
    dragging = false;
    container.toggleAttribute('data-resizing', false);
    if (dragPointerId !== undefined && typeof resizer.releasePointerCapture === 'function') {
      try {
        resizer.releasePointerCapture(dragPointerId);
      } catch {
        // Capture may already be gone (element detached, pointer lost); nothing to clean up.
      }
    }
    dragPointerId = undefined;
  }

  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    dragPointerId = event.pointerId;
    startX = event.clientX;
    startWidth = currentWidth;
    requested = startWidth;
    container.toggleAttribute('data-resizing', true);
    if (typeof resizer.setPointerCapture === 'function') {
      try {
        resizer.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is unavailable in some test/embedding environments. There are no
        // document-level listeners, so without it the drag only tracks while the pointer stays
        // over the divider.
      }
    }
  });

  resizer.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    requested = startWidth + (event.clientX - startX);
    scheduleResize();
  });

  resizer.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    cancelScheduledResize();
    const committed = startWidth + (event.clientX - startX);
    endDrag();
    resizeCb?.(committed, true);
  });

  resizer.addEventListener('pointercancel', () => {
    if (!dragging) return;
    cancelScheduledResize();
    const committed = requested;
    endDrag();
    resizeCb?.(committed, true);
  });

  resizer.addEventListener('lostpointercapture', () => {
    if (!dragging) return;
    cancelScheduledResize();
    const committed = requested;
    endDrag();
    resizeCb?.(committed, true);
  });

  resizer.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      resizeCb?.(currentWidth - 16, true);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      resizeCb?.(currentWidth + 16, true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      resizeCb?.(currentBounds.min, true);
    } else if (event.key === 'End' && Number.isFinite(currentBounds.max)) {
      event.preventDefault();
      resizeCb?.(currentBounds.max, true);
    }
  });

  resizer.addEventListener('dblclick', () => {
    resizeCb?.(currentBounds.reset, true);
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
    row.innerHTML = DIR_ROW_HTML;
    setText(row, '.ctg-name', dir.name);
    setText(
      row,
      '.ctg-count',
      `${dir.files.toLocaleString('en-US')} ${dir.files === 1 ? 'file' : 'files'}`,
    );
    setText(row, '.ctg-add', `+${dir.additions.toLocaleString('en-US')}`);
    setText(row, '.ctg-del', `${MINUS}${dir.deletions.toLocaleString('en-US')}`);

    const group = doc.createElement('ul');
    group.className = 'ctg-group';
    group.setAttribute('role', 'group');
    // Every folder starts expanded, so each child's own group (if it has one) is counted too.
    let rows = 0;
    for (const child of dir.children) {
      const childLi = renderNode(child, depth + 1);
      group.appendChild(childLi);
      rows += 1;
      if (child.kind === 'dir') {
        const childGroup = childLi.querySelector<HTMLUListElement>(':scope > .ctg-group');
        if (childGroup) rows += rowCounts.get(childGroup) ?? 0;
      }
    }
    rowCounts.set(group, rows);
    group.style.setProperty('--ctg-rows', String(rows));

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
    row.innerHTML = FILE_ROW_HTML;
    row.querySelector('.ctg-icon')?.classList.add(STATUS_CLASS[change.status]);
    setText(row, '.ctg-name', file.name);
    const meta = row.querySelector('.ctg-meta');
    if (meta) {
      if (change.binary) {
        meta.textContent = 'BIN';
      } else {
        meta.innerHTML = `<span class="ctg-add"></span><span class="ctg-del"></span>`;
        setText(meta, '.ctg-add', `+${change.additions.toLocaleString('en-US')}`);
        setText(meta, '.ctg-del', `${MINUS}${change.deletions.toLocaleString('en-US')}`);
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
      resizer.hidden = !open;
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
      // Every folder starts expanded, so every rendered row is currently in the DOM.
      const rowCount = tree.querySelectorAll('.ctg-item').length;
      tree.toggleAttribute('data-large', rowCount > LARGE_TREE_ROWS);

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
    setWidth(width, bounds) {
      currentWidth = width;
      currentBounds = bounds;
      resizer.setAttribute('aria-valuenow', String(width));
      resizer.setAttribute('aria-valuemin', String(bounds.min));
      if (Number.isFinite(bounds.max)) {
        resizer.setAttribute('aria-valuemax', String(bounds.max));
      } else {
        resizer.removeAttribute('aria-valuemax');
      }
      resizer.setAttribute('aria-valuetext', `${width} pixels`);
    },
    onResize(cb) {
      resizeCb = cb;
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
