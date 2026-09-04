# Compare Tree for GitHub: design spec

- Date: 2026-09-04
- Status: design approved in conversation, awaiting written-spec review
- Deliverable: a Chrome extension (Manifest V3) published on the Chrome Web Store

## 1. Problem

GitHub's branch compare page (`https://github.com/{owner}/{repo}/compare/{base}...{head}`)
shows a long commit list and a long stream of file diffs, but no tree of the folders and
files that changed. The pull request "Files changed" page has such a tree. Teams that want a
structural overview of a branch diff without opening a PR (and triggering CI on it) have no
option today.

The extension injects a PR-style file tree into the compare page: folders and files, per-file
additions and deletions, per-folder rollups, and click-to-jump to each diff.

## 2. Goals and non-goals

Goals for v1:

- Zero setup. No token, no options page. Works on private repositories through the user's
  existing GitHub session.
- Complete file list even for large compares (hundreds or thousands of files).
- Per-file status (added, modified, removed, renamed), additions and deletions, binary flag.
- Per-folder rollups: file count, additions, deletions.
- Click a file to jump to its diff, including diffs GitHub has not streamed in yet.
- Follows GitHub's light, dark, and dimmed themes.
- Degrades silently when GitHub markup changes; never breaks the page.
- Small permission surface suitable for Chrome Web Store review.

Non-goals for v1 (all considered, all deferred):

- Commit pages (`/commit/{sha}`), pull request pages, GitHub Enterprise Server hosts.
- Filter or search box, resize handle, compression of single-child folder chains.
- Firefox or Edge store listings (the build supports them, publishing is out of scope).
- Any telemetry, analytics, or network calls other than the diff download from github.com.

## 3. Verified facts about GitHub's compare page (checked 2026-09-04)

Everything below was verified against live github.com pages in a browser session. The
implementation relies on these facts, and the page adapter (section 6) isolates them.

Page structure and navigation:

- The compare page is GitHub's classic server-rendered diff view inside
  `turbo-frame#repo-content-turbo-frame`. Navigation is driven by Turbo (`window.Turbo`
  exists), so switching branches is a soft navigation, not a full page load.
- Tabs are anchors: `a.tabnav-tab.js-compare-tab[href="#commits_bucket"]` and
  `a.tabnav-tab.js-compare-tab[href="#files_bucket"]`. The Files tab label reads
  `Files changed N` (N may contain thousands separators). `#files_bucket` carries `d-none`
  until the Files tab is active.
- Both tab bodies load lazily through same-origin fragments:
  `/{owner}/{repo}/compare/commit-list?range={range}` and
  `/{owner}/{repo}/compare/file-list?range={range}`.
- Files tab DOM: `#files_bucket > div.container-xl > #diff` whose children are, in order,
  `#toc`, a `template`, `#files.diff-view.js-diff-container`, two hidden buttons, and an
  absolutely positioned placeholder `svg`.
- `#toc .toc-diff-stats` reads `Showing N changed files with A additions and D deletions.`
  For small compares `#toc` also lists every file; at 475 files that list is omitted entirely.
- Diffs stream progressively, 15 files per chunk, through chained
  `include-fragment[src="/{owner}/{repo}/diffs?bytes=…&lines=…&sha1=…&sha2=…&start_entry=N…"]`
  elements inside `.js-diff-progressive-container`. They load eagerly, without scrolling.
- Each file renders as `div.file.js-file[id="diff-{hash}"]` with `data-tagsearch-path`,
  `data-file-type`, `data-file-deleted`, and a child
  `.file-header[data-path][data-anchor][data-short-path]`.
- `{hash}` is the lowercase hex SHA-256 of the UTF-8 file path. For renamed files it is the
  hash of the new path. Verified on 3 ordinary files and 18 renames.
- Large or deleted files may render a deferred body ("Load diff" via
  `.js-diff-entry-loader[data-fragment-url]`), but the container with its id still exists.
- Both `#files_bucket > .container-xl` and its ancestor
  `div.new-discussion-timeline.container-xl` cap width at 1280 px.
- Primer CSS variables are defined on the root element and inherit into shadow roots:
  `--fgColor-default`, `--fgColor-muted`, `--fgColor-accent`, `--fgColor-success`,
  `--fgColor-danger`, `--bgColor-default`, `--bgColor-muted`, `--borderColor-default`.
  The legacy `--color-*` variables are gone. Theme attributes: `data-color-mode`,
  `data-light-theme`, `data-dark-theme`.

Data sources, measured from inside a github.com tab:

| Source | Result |
|---|---|
| `GET /{owner}/{repo}/compare/{range}.diff` | `text/plain` unified diff, same origin, session cookies apply, no redirect. Complete: 475 files matched GitHub's own count exactly; 1,579 files showed no truncation. Works with slashes in branch names and dots in tag names. |
| Same, sizes | 29 files: 46 KB in 0.3 s. 475 files: 1.3 MB in 0.9 s. 1,579 files: 6.1 MB in 9.6 s. |
| REST `GET /repos/{o}/{r}/compare/{range}` | Files capped at 300 (documented, and observed: exactly 300 returned for the 475-file compare). Commits capped at 250. Includes patches, 1.9 MB. Rejected. |
| Git trees API, two recursive trees diffed by blob SHA | Complete and fast (2 requests, ~0.4 s each), but needs a token, gives no line counts, and shows renames as add plus remove. Rejected for v1. |

## 4. Architecture

Approach A from the design discussion: a content-script-only extension. No background
service worker, no options page, no host permissions beyond the content script match.

Stack: WXT 0.21.x, TypeScript (strict), pnpm, Vitest, Prettier. No UI framework. Node 22+.

```
compare-tree-for-github/
  wxt.config.ts                  manifest, srcDir 'src', auto-icons module
  package.json                   scripts: dev, build, zip, test, typecheck, format
  vitest.config.ts               WxtVitest plugin, jsdom environment
  src/
    entrypoints/
      compare.content.ts         content script: orchestration and lifecycle only
    lib/
      page.ts                    GitHub page adapter (all selectors, URLs, anchors, layout)
      diff-parser.ts             pure: unified diff text -> FileChange[] and totals
      tree.ts                    pure: FileChange[] -> DirNode tree with rollups
      render.ts                  sidebar DOM inside the shadow root
      prefs.ts                   persisted UI preferences (WXT storage)
      icons.ts                   inline Octicon SVG strings
    assets/
      sidebar.css                shadow-root styles built on Primer variables
      icon.svg                   extension icon source
  tests/
    fixtures/*.diff              captured real diffs plus hand-built edge cases
    *.test.ts
  docs/superpowers/specs/        this document
  .github/workflows/ci.yml       test, typecheck, build, zip on push; release on tags
```

Module responsibilities and dependencies:

| Module | Does | Depends on |
|---|---|---|
| `compare.content.ts` | Runs the sync routine on load and on Turbo navigation. Wires fetch, parser, tree, renderer, prefs together. Owns the AbortController. | all `lib/*` |
| `page.ts` | Parses compare URLs, builds the `.diff` URL, finds and waits for GitHub elements, computes anchors, applies and removes the grid layout, reads the tab file count, scrolls to a file, observes the active file. The only module that knows GitHub markup. | DOM, `crypto.subtle` |
| `diff-parser.ts` | Streaming line parser for git unified diffs. | nothing |
| `tree.ts` | Builds the nested folder tree, sorts it, computes rollups. | nothing |
| `render.ts` | Renders header, status, and tree into a container. Emits callbacks for file clicks and toggles. Keeps expand state. | `icons.ts` |
| `prefs.ts` | `sidebarOpen` boolean, default true. | WXT `storage` |

## 5. Data model

```ts
type FileStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'copied';

interface FileChange {
  path: string;          // new path for renames and copies
  oldPath?: string;      // set for renamed and copied
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

interface DiffSummary {
  files: FileChange[];
  additions: number;
  deletions: number;
}

interface DirNode {
  kind: 'dir';
  name: string;          // '' for the root
  path: string;          // '' for the root, otherwise 'a/b/c' without trailing slash
  children: Array<DirNode | FileNode>;
  files: number;         // rollup: files in this subtree
  additions: number;     // rollup
  deletions: number;     // rollup
}

interface FileNode {
  kind: 'file';
  name: string;
  path: string;
  change: FileChange;
}

type SidebarState =
  | { kind: 'loading'; expectedFiles: number | null; bytes: number }
  | { kind: 'ready'; warning?: string }
  | { kind: 'error'; message: string };
```

Anchors are not stored in the tree. They are computed on demand when a file is clicked
(`anchorFor(path)`), cached in a `Map<string, string>`. Active-file highlighting uses the
`data-path` attribute GitHub puts on each file header, so it never needs anchors.

## 6. Page adapter (`page.ts`)

URL handling:

- `parseCompareUrl(url: string): { owner; repo; range } | null`. The pathname must match
  `^/([^/]+)/([^/]+)/compare/(.+)$`. The range is everything after `/compare/` with any
  trailing slash removed, kept URL-encoded as-is. Query string and hash are ignored. A bare
  `/compare` or `/compare/` returns null. Ranges may contain `...`, `..`, slashes, dots, and
  fork prefixes like `user:branch`; none of these are interpreted.
- `diffUrl(parts)` returns `${location.origin}/${owner}/${repo}/compare/${range}.diff`.
- `compareKey(parts)` returns `${owner}/${repo}/${range}` for change detection.

Elements and waiting:

- `waitFor(selector, timeoutMs)` resolves when the selector matches, using a
  MutationObserver on `document.body` with `childList` and `subtree`, and rejects after the
  timeout (15 s default). Used for `#files_bucket #files` because the file list arrives via a
  fragment after the page renders.
- `readTabFileCount()` parses the digits from the Files tab label, or returns null.
- `findDiffRoot()` returns `{ bucket: #files_bucket, diff: #diff, files: #files }` or null.

Anchors and scrolling:

- `anchorFor(path)` returns `'diff-' + hex(sha256(utf8(path)))` via `crypto.subtle.digest`.
- `scrollToFile(path, signal)`: compute the anchor, look up `document.getElementById`. If
  present, scroll it to `--ctg-sticky-top` below the viewport top and `history.replaceState`
  the hash to `#diff-…`. If absent, observe `#files` for up to 20 s until it appears, then do
  the same. Returns a promise that resolves true on success, false on timeout or abort.
- `observeActiveFile(onChange)`: an IntersectionObserver over `.file-header[data-path]`
  elements with `rootMargin: '0px 0px -80% 0px'`, so the header nearest the top of the
  viewport is the active one. A MutationObserver on `#files` attaches newly streamed headers.
  Returns a disposer.

Layout:

- `applyLayout(open: boolean)` toggles the `data-ctg-open` attribute on `#files_bucket` and
  ensures a single `<style id="ctg-page-style">` exists in `document.head` with these rules
  (page-level CSS, outside the shadow root, because it must style GitHub's own elements):

```css
#files_bucket[data-ctg-open] #diff { display: grid; grid-template-columns: var(--ctg-sidebar-width, 320px) minmax(0, 1fr); column-gap: 16px; align-items: start; }
#files_bucket[data-ctg-open] #diff > * { grid-column: 1 / -1; }
#files_bucket[data-ctg-open] #diff > compare-tree-sidebar { grid-column: 1; grid-row: 2; position: sticky; top: var(--ctg-sticky-top, 8px); max-height: calc(100vh - var(--ctg-sticky-top, 8px) - 8px); overflow: auto; }
#files_bucket[data-ctg-open] #diff > #files { grid-column: 2; grid-row: 2; min-width: 0; }
#files_bucket[data-ctg-open] > .container-xl, div.container-xl:has(> #files_bucket[data-ctg-open]) { max-width: none; }
```

- The sidebar host element is inserted immediately before `#files`, so grid auto-placement
  puts `#toc` on row 1 spanning both columns and the sidebar and diff list side by side on
  row 2. No GitHub element is moved or re-parented.
- When the sidebar is closed the attribute is absent, GitHub's layout is untouched, and the
  host element renders as a slim bar above the diff list holding a "Show file tree" button.
- `removeLayout()` removes the attribute; the style element stays (idempotent, harmless).
- `--ctg-sticky-top` defaults to 8 px. If GitHub renders a sticky header on the page, the
  adapter measures it once at mount and sets the variable on `#files_bucket`.

## 7. Diff parser (`diff-parser.ts`)

Interface: `createDiffParser()` returns `{ push(chunk: string): void; end(): DiffSummary; current(): DiffSummary }`.
`push` splits on `\n`, keeps the trailing partial line for the next chunk, strips a trailing
`\r`, and feeds complete lines to the state machine. `current()` gives a snapshot for
progress display.

State machine per file:

- `diff --git a/OLD b/NEW` starts a new file and enters the header state. The path pair is
  taken by the symmetric split rule: with `s` being the text after `diff --git `, if
  `s.length` is odd and `s.slice(2, (s.length - 1) / 2)` equals `s.slice((s.length + 5) / 2)`,
  that is the path (the common, unrenamed case). Otherwise the paths are provisional and are
  overwritten by later header lines, in this precedence: `rename from` / `rename to` and
  `copy from` / `copy to` lines are authoritative, then `--- a/…` / `+++ b/…` lines, then the
  header split.
- Quoted paths: git wraps unusual paths in double quotes with C escapes. Unquote by handling
  `\"`, `\\`, `\t`, `\n`, `\r`, `\a`, `\b`, `\f`, `\v`, and octal `\ooo` sequences; octal
  bytes are collected and decoded as UTF-8. Applies to every place a path appears.
- Header lines: `new file mode` sets added; `deleted file mode` sets removed;
  `rename from` / `rename to` set renamed and `oldPath`; `copy from` / `copy to` set copied;
  `old mode` / `new mode` and `index` lines are accepted and otherwise ignored;
  `similarity index` and `dissimilarity index` are ignored.
- `Binary files … differ` and `GIT binary patch` set `binary = true`; counts stay 0. Binary
  patch payload lines are skipped until the next `diff --git`.
- `--- ` and `+++ ` lines are only interpreted in the header state. `--- /dev/null` confirms
  added; `+++ /dev/null` confirms removed.
- `@@ … @@` enters the hunk state. In the hunk state, lines starting with `+` add one
  addition, `-` one deletion, ` ` or an empty line are context, `\ No newline at end of file`
  is ignored, and a new `@@` starts another hunk. The hunk state ends only at the next
  `diff --git`. This ordering matters: content lines starting with `--- ` or `+++ ` inside a
  hunk must not be mistaken for headers.
- Submodule pointer changes appear as `-Subproject commit …` / `+Subproject commit …` and are
  counted as 1 and 1, which matches GitHub.
- Unknown lines are ignored. Truncated input still yields the files seen so far.
- A file with no hunks and no binary marker (mode-only change) is reported as modified with
  counts 0 and 0.

Totals: `files.length`, sum of additions, sum of deletions.

## 8. Tree builder (`tree.ts`)

`buildTree(files: FileChange[]): DirNode`.

- Split each path on `/`; every prefix becomes a `DirNode` created on demand; the last
  segment becomes a `FileNode`. Root-level files sit directly under the root.
- Rollups: each directory's `files`, `additions`, and `deletions` are the sums over its
  subtree. The root's rollups equal the diff totals.
- Sort every `children` array: directories first, then files, each group ordered with
  `localeCompare(undefined, { numeric: true, sensitivity: 'base' })`.
- One level per directory, mirroring GitHub's PR tree. No chain compression in v1.
- Pure and synchronous. Duplicate paths (should not happen) are tolerated: the later entry
  replaces the earlier one.

## 9. Renderer (`render.ts`) and styles

Mounting: WXT `createShadowRootUi(ctx, { name: 'compare-tree-sidebar', position: 'inline',
anchor: '#files_bucket #files', append: 'before', onMount, onRemove })` with
`cssInjectionMode: 'ui'` so `assets/sidebar.css` is bundled into the shadow root.

API:

```ts
interface Sidebar {
  setOpen(open: boolean): void;                  // open sidebar vs slim "Show file tree" bar
  setState(state: SidebarState): void;           // loading, ready (with optional warning), error
  setTree(root: DirNode): void;                  // full render, expanded by default
  setActive(path: string | null): void;          // highlight the file under the viewport top
  onToggleOpen(cb: (open: boolean) => void): void;
  onSelectFile(cb: (path: string) => Promise<boolean>): void;
  onRetry(cb: () => void): void;
}
```

Structure inside the shadow root:

- Header: title "Files changed", totals (`N files`, `+A` in success color, `−D` in danger
  color), buttons "Collapse all", "Expand all", and a close button. Below it the status line
  (spinner and "Loading N files… 1.2 MB", or the error message with a Retry button, or the
  count-mismatch warning).
- Tree: `ul[role=tree]`, directory items `li[role=treeitem][aria-expanded]` containing a
  row `button` (chevron, folder icon, name, rollups `N files  +A −D` in muted text) and a
  nested `ul[role=group]`. File items `li[role=treeitem]` containing a row `button`
  (status icon, name, `+A −D`, or `BIN` for binaries) with `title` set to the full path,
  and for renames `old → new`.
- Closed state: the host shows only a slim bar with a "Show file tree" button.

Behavior:

- Clicking a directory row toggles it. "Collapse all" and "Expand all" affect every directory.
  Expand state lives in memory for the current mount only.
- Clicking a file row calls the `onSelectFile` callback and shows a small spinner on that row
  until the returned promise settles; the spinner is cleared either way.
- Keyboard: rows are native buttons, so Tab, Enter, and Space work. Arrow Left collapses and
  Arrow Right expands a focused directory row.
- Event delegation: one click listener and one keydown listener on the tree root.
- The tree is built into a `DocumentFragment` and swapped in once.

Styles (`sidebar.css`):

- Colors and borders only through Primer variables, each with a fallback for safety:
  text `var(--fgColor-default, #1f2328)`, muted `var(--fgColor-muted, #59636e)`, additions
  `var(--fgColor-success, #1a7f37)`, deletions `var(--fgColor-danger, #d1242f)`, active row
  background `var(--bgColor-muted, #f6f8fa)`, border `var(--borderColor-default, #d1d9e0)`.
- 12 px text, 26 px rows, 16 px indent per level, names truncated with an ellipsis, row hover
  background, focus ring with `outline: 2px solid var(--fgColor-accent)`.
- Icons: inline Octicons (MIT): chevron-right, chevron-down, file-directory-fill, and the
  status icons diff-added, diff-modified, diff-removed, diff-renamed, colored via the
  variables above.

## 10. Preferences (`prefs.ts`)

`const sidebarOpen = storage.defineItem<boolean>('local:sidebarOpen', { fallback: true })`.
Read once per mount, written on every toggle. Requires the `storage` permission.

## 11. Lifecycle (`compare.content.ts`)

Content script definition: `matches: ['https://github.com/*/*/compare/*']`,
`runAt: 'document_idle'`, `cssInjectionMode: 'ui'`.

Sync routine, run once at start and on every `wxt:locationchange` event:

1. `parts = parseCompareUrl(location.href)`. If null: abort any in-flight work, unmount if
   mounted, clear state, return.
2. `key = compareKey(parts)`. If equal to the mounted key, return.
3. Abort in-flight work (AbortController), unmount the previous sidebar, remove the layout
   attribute, and remove any stale `compare-tree-sidebar` element left by Turbo's page cache.
4. `await waitFor('#files_bucket #files', 15000)`. On timeout: log one `console.warn` with the
   extension version and return.
5. Mount the sidebar before `#files`, read `sidebarOpen`, apply layout accordingly, set state
   to loading with `expectedFiles = readTabFileCount()`.
6. Fetch `diffUrl(parts)` with `credentials: 'same-origin'` and the abort signal. Reject a
   response that is not `ok` or whose `content-type` does not start with `text/plain` (a
   sign-in page comes back as HTML). Stream through `TextDecoderStream`, feeding each chunk to
   the parser and updating the loading state with bytes received.
7. On end: `summary = parser.end()`, `root = buildTree(summary.files)`, `setTree(root)`. If
   `expectedFiles` is a number and differs from `summary.files.length`, set state ready with
   the warning "GitHub reports N files, the diff contained M". Otherwise state ready.
8. Start `observeActiveFile` and route it to `setActive`.

Event wiring: `onToggleOpen` writes the preference and calls `applyLayout`; `onSelectFile`
calls `scrollToFile(path, signal)`; `onRetry` re-runs steps 5 to 8 for the current key.

Fetch starts regardless of which tab is active. The sidebar lives inside `#files_bucket`, so
GitHub's own tab switching shows and hides it.

Teardown: every listener and observer is registered through the WXT content script context
(`ctx.addEventListener`, `ctx.setInterval`, `ctx.onInvalidated`) so an extension update or
reload disposes them. Unmount removes the host element and the layout attribute.

## 12. Error handling

- Fetch failures (network error, non-OK status, non-text response) show the error state with a
  Retry button. No automatic retries. The message distinguishes "not signed in or no access"
  (HTML response or 404) from a generic failure.
- Missing GitHub elements after the wait timeout: one console warning, no UI, no exceptions.
- Any exception in the sync routine is caught at the top level, logged once, and leaves the
  page untouched.
- Aborted fetches (navigation during download) are swallowed silently.
- Count mismatch between the tab label and the parsed diff is shown as a warning, never
  treated as a failure.

## 13. Performance

- Streaming parse keeps memory bounded to the current chunk plus the growing file array; no
  full-text string is retained.
- One render per compare. Directory toggles flip a class and `aria-expanded`; nothing is
  re-rendered.
- Thousands of rows as plain DOM are acceptable in v1; virtualization is out of scope.
- Anchors are hashed lazily on click and cached.
- The intersection observer observes headers only, and new headers are attached as GitHub
  streams chunks.

## 14. Testing

Unit tests (Vitest, `WxtVitest` plugin, jsdom for renderer tests):

- `diff-parser`: the captured Express `4.18.2...4.19.2` fixture must yield 29 files, 611
  additions, 167 deletions, which are GitHub's own summary numbers. A hand-built fixture
  covers added, removed, renamed with and without content changes, copied, binary
  (`Binary files` and `GIT binary patch`), mode-only change, submodule pointer, quoted paths
  with spaces and UTF-8 octal escapes, `\ No newline at end of file`, an empty added file,
  content lines beginning with `--- ` and `+++ ` inside a hunk, CRLF input, and truncated
  input. Chunk-boundary tests push the same fixture in 1-byte, 7-byte, and 4 KB chunks and
  expect identical output.
- `tree`: nesting, root-level files, rollups equal totals, directories-first ordering with
  numeric-aware sorting, repeated folder names at different depths.
- `page`: URL parsing for tags with dots, branches with slashes, two-dot and three-dot ranges,
  fork-prefixed ranges, trailing slashes, query strings and hashes, bare `/compare`.
  Anchor hashing against captured real pairs:
  `.github/workflows/ci.yml` → `diff-b803fcb7f17ed9235f1e5cb1fcd2f5d3b2838429d4368ae4c57ce4436577f03f`,
  `Contributing.md` → `diff-1246fcebc419eba2aaf5b810ef51db6ec5606f34da054746e1b31bdd7378405d`,
  `History.md` → `diff-abfa5988643af1b8b2600aac13b273922dbb3372e021bf1d7caadfe7473c9561`,
  and the renamed file `patches/chokidar@3.6.0.patch` →
  `diff-e30bf28f21a7a6699eff3322122ef8c62a049ab8145f9d2aa2f9ee929a139774`.
  Layout application and removal on a fixture DOM copied from the real page structure.
- `render`: structure and ARIA attributes, toggle, collapse all and expand all, file click
  callback with spinner lifecycle, keyboard activation and arrow keys, state transitions,
  closed-state bar.
- `prefs`: default true, persistence round trip using the in-memory fake browser.

Manual verification (WXT dev mode in Chrome):

- Public compares at three sizes: `expressjs/express` `4.18.2...4.19.2` (29 files),
  `vitejs/vite` `v5.0.0...v5.1.0` (475 files, 26 renames, 4 binaries),
  `microsoft/vscode` `1.85.0...1.86.0` (1,579 files).
- The private `volvo-cars/mfg-cws` compare from the original screenshots.
- Light and dark themes. Commits tab first, then Files. Switching the compare branches
  (Turbo navigation). Back and forward. Bare `/compare` page. A range with a slash.
- Clicking a file whose chunk has not streamed yet on the 1,579-file compare.

## 15. Packaging, store, repository

Manifest (generated by WXT from `wxt.config.ts`):

- `name`: Compare Tree for GitHub. `description`: Adds a PR-style tree of changed folders and
  files to GitHub's branch compare page, with per-folder change counts.
- `version` from `package.json`, starting at 0.1.0.
- `permissions: ['storage']`. No `host_permissions`. Content script match only
  `https://github.com/*/*/compare/*`.
- Icons in 16, 32, 48, 128 generated by `@wxt-dev/auto-icons` from `src/assets/icon.svg`.

Scripts: `dev` (`wxt`), `build` (`wxt build`), `zip` (`wxt zip`), `test` (`vitest run`),
`typecheck` (`tsc --noEmit`), `format` (`prettier --write .`).

Continuous integration (`.github/workflows/ci.yml`): on push and pull request, install with
pnpm, run typecheck, tests, build, and zip, and upload the zip as an artifact. On a `v*` tag,
create a GitHub release with the zip attached.

Chrome Web Store listing (drafted in `docs/store/`, provided to the user for approval):
128 px icon, at least one 1280 by 800 screenshot, short description (under 132 characters),
detailed description, single-purpose statement, `storage` permission justification, and a
privacy statement: the extension stores one UI preference locally and makes no network
requests other than downloading the diff from github.com for the page being viewed; it
collects and transmits no data.

Repository: MIT license, README with a screenshot or GIF and an install section, CHANGELOG,
`.gitignore` for `node_modules`, `.output`, `.wxt`. Creating the public GitHub repository is
an outward-facing step and requires explicit confirmation from the user.

## 16. Future work (not in v1)

- Commit pages and pull request pages that lack the tree.
- GitHub Enterprise Server hosts through optional host permissions and an options page.
- Filter box, resize handle, single-child folder chain compression, persisted expand state.
- Firefox and Edge store publishing.

## 17. Decision log

- Audience: public Chrome Web Store. Chosen by the user over personal or team-only use.
- v1 scope: core tree plus per-folder rollups. Filter box, commit pages, and Enterprise hosts
  deferred by the user.
- Data source: the same-origin `.diff` download. Chosen for completeness, zero setup, and
  private-repo support. REST compare rejected for its 300-file cap; git trees rejected for
  requiring a token.
- Architecture: content-script-only with WXT and TypeScript. Background-worker variant and
  zero-build variant rejected as more plumbing or weaker tooling for no v1 benefit.
- Layout: CSS grid applied to GitHub's existing container, lifting the 1280 px cap while the
  sidebar is open. No GitHub nodes are moved.
