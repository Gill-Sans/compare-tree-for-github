# Compare Tree for GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension that injects a PR-style tree of changed folders and files, with per-folder rollups and click-to-jump, into GitHub's branch compare page.

**Architecture:** A single content script matched to GitHub compare URLs downloads the compare's `.diff` (same origin, so the user's session applies), streams it through a pure diff parser into a folder tree, and renders a sidebar inside a shadow root beside GitHub's diff list. A page adapter module isolates every GitHub selector and URL rule; a controller module owns the lifecycle so Turbo navigations, aborts, and errors are handled in one place.

**Tech Stack:** WXT 0.21 (Manifest V3, TypeScript strict, Vite 8), pnpm 11, Vitest 4 with jsdom, Prettier, `@wxt-dev/auto-icons`. No UI framework, no background worker.

**Spec:** `docs/superpowers/specs/2026-09-04-compare-tree-for-github-design.md`

## Global Constraints

- Node `>=22` (machine has 24.19), pnpm 11, package manager pinned as `pnpm@11.22.0`.
- WXT `^0.21.4`, TypeScript `^6.0.3` in strict mode, Vite `^8.2.0`, Vitest `^4.1.10`, jsdom `^30.0.1`.
- Manifest name `Compare Tree for GitHub`; description `Adds a PR-style tree of changed folders and files to GitHub's branch compare page, with per-folder change counts.` (113 characters, under the 132 limit); version `0.1.0` from package.json.
- Manifest permissions exactly `['storage']`. No `host_permissions`. Content script match exactly `https://github.com/*/*/compare/*`, `runAt: 'document_idle'`, `cssInjectionMode: 'ui'`.
- The only network request the extension makes is `GET {origin}/{owner}/{repo}/compare/{range}.diff` with `credentials: 'same-origin'`.
- Colors and borders only through Primer variables with fallbacks: `--fgColor-default` `#1f2328`, `--fgColor-muted` `#59636e`, `--fgColor-accent` `#0969da`, `--fgColor-success` `#1a7f37`, `--fgColor-danger` `#d1242f`, `--fgColor-attention` `#9a6700`, `--bgColor-default` `#fff`, `--bgColor-muted` `#f6f8fa`, `--borderColor-default` `#d1d9e0`.
- Sidebar: 12 px text, 26 px rows, 16 px indent per level, 320 px wide (`--ctg-sidebar-width`), sticky top default 8 px (`--ctg-sticky-top`).
- Timeouts: 15 s waiting for GitHub's file list, 20 s waiting for a not-yet-streamed diff when jumping.
- Host element tag `compare-tree-sidebar`, page attribute `data-ctg-open` on `#files_bucket`, page style element id `ctg-page-style`. All injected CSS classes are prefixed `ctg-`.
- Never write large files through a Bash heredoc on this machine: commands over roughly 8 KB are cut off. Use the Write tool for files; use Bash for short commands only.
- The project directory is `D:\Users\gill\Documents\Personal-Projects\compare-tree-for-github` (already a git repo with one commit containing the spec). Run every command from that directory.

---

## File structure

| Path | Responsibility |
|---|---|
| `package.json`, `pnpm-lock.yaml` | dependencies and scripts: `dev`, `build`, `zip`, `test`, `typecheck`, `format` |
| `wxt.config.ts` | manifest fields, `srcDir: 'src'`, `imports: false`, auto-icons module |
| `tsconfig.json` | extends WXT's generated config, strict |
| `vitest.config.ts` | `WxtVitest` plugin, tests under `tests/` |
| `.gitignore`, `.gitattributes`, `.prettierrc`, `.prettierignore`, `LICENSE` | repository hygiene |
| `src/entrypoints/compare.content.ts` | content script: builds the controller, wires WXT's shadow-root UI and navigation events. No logic. |
| `src/lib/types.ts` | shared data types: `FileChange`, `DiffSummary`, `DirNode`, `FileNode`, `TreeNode`, `SidebarState` |
| `src/lib/diff-parser.ts` | pure streaming unified-diff parser |
| `src/lib/tree.ts` | pure folder tree builder with rollups and sorting |
| `src/lib/page.ts` | GitHub page adapter: URL parsing, selectors, anchors, waiting, layout, scrolling, active-file observer. The only module that knows GitHub markup. |
| `src/lib/icons.ts` | inline Octicon SVG strings |
| `src/lib/render.ts` | sidebar DOM renderer with the `Sidebar` interface |
| `src/lib/prefs.ts` | persisted `sidebarOpen` preference through WXT storage |
| `src/lib/controller.ts` | lifecycle: sync per URL, abort, wait, mount, fetch and stream, error states, observers |
| `src/assets/sidebar.css` | shadow-root styles |
| `src/assets/icon.svg` | extension icon source, rasterized by auto-icons |
| `tests/fixtures/edge-cases.diff` | hand-built diff covering every parser edge case |
| `tests/fixtures/express-4.18.2-to-4.19.2.diff` | captured real diff, 29 files, +611 −167 |
| `tests/helpers/page-dom.ts` | builds a copy of GitHub's compare DOM for jsdom tests |
| `tests/*.test.ts` | one test file per module |
| `.github/workflows/ci.yml` | typecheck, test, zip, artifact, release on tags |
| `README.md`, `CHANGELOG.md`, `docs/store/listing.md`, `docs/store/privacy.md` | docs and store listing drafts |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.gitattributes`, `.prettierrc`, `.prettierignore`, `LICENSE`
- Create: `src/entrypoints/compare.content.ts` (placeholder, replaced in Task 9)
- Create: `src/assets/icon.svg`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a building, testable WXT project. Later tasks import from `#imports` (WXT's explicit import module, enabled because auto-imports are turned off) and run `pnpm test`, `pnpm typecheck`, `pnpm build`.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "compare-tree-for-github",
  "version": "0.1.0",
  "private": true,
  "description": "Adds a PR-style tree of changed folders and files to GitHub's branch compare page, with per-folder change counts.",
  "type": "module",
  "packageManager": "pnpm@11.22.0",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "postinstall": "wxt prepare"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@wxt-dev/auto-icons": "^1.1.2",
    "jsdom": "^30.0.1",
    "prettier": "^3.9.6",
    "typescript": "^6.0.3",
    "vite": "^8.2.0",
    "vitest": "^4.1.10",
    "web-ext": "^10.6.0",
    "wxt": "^0.21.4"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild", "sharp"]
  }
}
```

- [ ] **Step 2: Write wxt.config.ts**

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  imports: false,
  modules: ['@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'assets/icon.svg',
  },
  manifest: {
    name: 'Compare Tree for GitHub',
    description:
      "Adds a PR-style tree of changed folders and files to GitHub's branch compare page, with per-folder change counts.",
    permissions: ['storage'],
  },
});
```

- [ ] **Step 3: Write tsconfig.json and vitest.config.ts**

`tsconfig.json` (WXT generates `.wxt/tsconfig.json` during `wxt prepare`, which runs on install):

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
```

Test files that need a DOM start with the comment `// @vitest-environment jsdom`; everything else runs in Node.

- [ ] **Step 4: Write the hygiene files**

`.gitignore`:

```
node_modules/
.output/
.wxt/
.env
.env.*
*.log
stats.html
```

`.gitattributes` (the machine's global git config converts to CRLF; force LF for the repo):

```
* text=auto eol=lf
*.png binary
```

`.prettierrc`:

```json
{
  "singleQuote": true,
  "semi": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

`.prettierignore` (the approved spec and plan under `docs/superpowers` stay byte-for-byte as reviewed):

```
.output
.wxt
pnpm-lock.yaml
tests/fixtures
docs/superpowers
```

`LICENSE`: the MIT license text with the line `Copyright (c) 2026 Gill Mertens`.

- [ ] **Step 5: Write the placeholder content script and the icon**

`src/entrypoints/compare.content.ts`:

```ts
import { defineContentScript } from '#imports';

export default defineContentScript({
  matches: ['https://github.com/*/*/compare/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  main() {
    console.debug('[compare-tree] content script loaded');
  },
});
```

`src/assets/icon.svg` (a blue tile with a folder, a trunk, and two indented file cards; auto-icons rasterizes it to 16, 32, 48, and 128 px):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#1f6feb"/>
  <path d="M24 30h20l8 8h34a4 4 0 0 1 4 4v18H24z" fill="#fff"/>
  <path d="M40 66v40M40 82h16M40 106h16" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
  <rect x="62" y="70" width="42" height="24" rx="6" fill="#fff"/>
  <rect x="62" y="98" width="42" height="24" rx="6" fill="#fff"/>
  <rect x="70" y="78" width="18" height="8" rx="2" fill="#2da44e"/>
  <rect x="70" y="106" width="18" height="8" rx="2" fill="#cf222e"/>
</svg>
```

- [ ] **Step 6: Write the smoke test**

`tests/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs a test', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Install and verify the toolchain**

Run:

```bash
pnpm install
```

Expected: completes, `postinstall` runs `wxt prepare` and creates `.wxt/`. If pnpm reports ignored build scripts for anything other than esbuild and sharp, add that package to `pnpm.onlyBuiltDependencies` and run `pnpm install` again.

Run:

```bash
pnpm typecheck && pnpm test
```

Expected: typecheck exits 0; Vitest reports `1 passed`.

Run:

```bash
pnpm build && cat .output/chrome-mv3/manifest.json
```

Expected: the manifest shows `"name": "Compare Tree for GitHub"`, `"version": "0.1.0"`, `"permissions": ["storage"]`, no `host_permissions`, one content script with `"matches": ["https://github.com/*/*/compare/*"]` and `"run_at": "document_idle"`, and `icons` entries for 16, 32, 48, 128 pointing at `icons/*.png`. Confirm the PNG files exist with `ls .output/chrome-mv3/icons`.

If jsdom 30 fails to initialize under Vitest in a later task, pin `"jsdom": "^27.0.0"` instead; nothing else in this plan depends on the jsdom major.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold WXT extension project"
```

---

### Task 2: Shared types and the streaming diff parser

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/diff-parser.ts`
- Create: `tests/fixtures/edge-cases.diff`
- Create: `tests/fixtures/express-4.18.2-to-4.19.2.diff` (downloaded)
- Test: `tests/diff-parser.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `types.ts`: `FileStatus`, `FileChange { path; oldPath?; status; additions; deletions; binary }`, `DiffSummary { files; additions; deletions }`, `DirNode`, `FileNode`, `TreeNode`, `SidebarState`.
  - `diff-parser.ts`: `createDiffParser(): DiffParser` where `DiffParser = { push(chunk: string): void; end(): DiffSummary; current(): DiffSummary }`, plus exported helpers `splitHeaderPaths(rest: string): { a: string; b: string } | null` and `readQuoted(s: string, start: number): { value: string; end: number } | null`.

- [ ] **Step 1: Write the shared types**

`src/lib/types.ts`:

```ts
export type FileStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'copied';

export interface FileChange {
  /** New path for renames and copies. */
  path: string;
  /** Previous path, present for renamed and copied files. */
  oldPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface DiffSummary {
  files: FileChange[];
  additions: number;
  deletions: number;
}

export interface DirNode {
  kind: 'dir';
  /** '' for the root. */
  name: string;
  /** '' for the root, otherwise 'a/b/c' without a trailing slash. */
  path: string;
  children: TreeNode[];
  /** Rollups over the whole subtree. */
  files: number;
  additions: number;
  deletions: number;
}

export interface FileNode {
  kind: 'file';
  name: string;
  path: string;
  change: FileChange;
}

export type TreeNode = DirNode | FileNode;

export type SidebarState =
  | { kind: 'loading'; expectedFiles: number | null; bytes: number }
  | { kind: 'ready'; warning?: string }
  | { kind: 'error'; message: string };
```

- [ ] **Step 2: Write the edge-case fixture**

`tests/fixtures/edge-cases.diff`. Write it exactly, including the empty line inside the binary patch and the final newline. Twelve files plus one unquoted path containing ` b/`.

```
diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 line1
-line2
+line2 changed
+line3
 line4
\ No newline at end of file
diff --git a/README.md b/README.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/README.md
@@ -0,0 +1,2 @@
+# Title
+--- not a header
diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-gone
-+++ also not a header
diff --git a/docs/a.md b/docs/b.md
similarity index 90%
rename from docs/a.md
rename to docs/b.md
index 5555555..6666666 100644
--- a/docs/a.md
+++ b/docs/b.md
@@ -1 +1 @@
-old
+new
diff --git a/pure-old.txt b/pure-new.txt
similarity index 100%
rename from pure-old.txt
rename to pure-new.txt
diff --git a/img/logo.png b/img/logo.png
new file mode 100644
index 0000000..7777777
Binary files /dev/null and b/img/logo.png differ
diff --git a/img/icon.png b/img/icon.png
index 8888888..9999999 100644
GIT binary patch
literal 100
zcmV-q0Bin{xxx
+not an addition
literal 0
HcmV?d00001

diff --git a/bin/run.sh b/bin/run.sh
old mode 100644
new mode 100755
diff --git a/vendor/lib b/vendor/lib
index aaaaaaa..bbbbbbb 160000
--- a/vendor/lib
+++ b/vendor/lib
@@ -1 +1 @@
-Subproject commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
+Subproject commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
diff --git "a/sp ace/caf\303\251.txt" "b/sp ace/caf\303\251.txt"
index ccccccc..ddddddd 100644
--- "a/sp ace/caf\303\251.txt"
+++ "b/sp ace/caf\303\251.txt"
@@ -1 +1,2 @@
 hi
+there
diff --git a/empty.txt b/empty.txt
new file mode 100644
index 0000000..e69de29
diff --git a/copy-src.txt b/copy-dst.txt
similarity index 100%
copy from copy-src.txt
copy to copy-dst.txt
diff --git a/with space/x b/y.txt b/with space/x b/y.txt
index eeeeeee..fffffff 100644
--- a/with space/x b/y.txt
+++ b/with space/x b/y.txt
@@ -1 +1 @@
-a
+b
```

Expected parse of this fixture, used by the tests below (13 files, +8 −6):

| # | path | oldPath | status | + | − | binary |
|---|---|---|---|---|---|---|
| 1 | `src/app.ts` | | modified | 2 | 1 | no |
| 2 | `README.md` | | added | 2 | 0 | no |
| 3 | `old.txt` | | removed | 0 | 2 | no |
| 4 | `docs/b.md` | `docs/a.md` | renamed | 1 | 1 | no |
| 5 | `pure-new.txt` | `pure-old.txt` | renamed | 0 | 0 | no |
| 6 | `img/logo.png` | | added | 0 | 0 | yes |
| 7 | `img/icon.png` | | modified | 0 | 0 | yes |
| 8 | `bin/run.sh` | | modified | 0 | 0 | no |
| 9 | `vendor/lib` | | modified | 1 | 1 | no |
| 10 | `sp ace/café.txt` | | modified | 1 | 0 | no |
| 11 | `empty.txt` | | added | 0 | 0 | no |
| 12 | `copy-dst.txt` | `copy-src.txt` | copied | 0 | 0 | no |
| 13 | `with space/x b/y.txt` | | modified | 1 | 1 | no |

- [ ] **Step 3: Download the Express fixture**

Run:

```bash
curl -sL -o tests/fixtures/express-4.18.2-to-4.19.2.diff "https://github.com/expressjs/express/compare/4.18.2...4.19.2.diff" && grep -c "^diff --git" tests/fixtures/express-4.18.2-to-4.19.2.diff
```

Expected: `29`. GitHub's own summary for this compare is 29 changed files, 611 additions, 167 deletions; counting `+` and `-` lines inside hunks of this file reproduces exactly those numbers, which is what the parser test asserts.

- [ ] **Step 4: Write the failing parser tests**

`tests/diff-parser.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDiffParser, readQuoted, splitHeaderPaths } from '../src/lib/diff-parser';
import type { DiffSummary } from '../src/lib/types';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const EDGE = fixture('edge-cases.diff');
const EXPRESS = fixture('express-4.18.2-to-4.19.2.diff');

function parseAll(text: string, chunkSize = text.length): DiffSummary {
  const parser = createDiffParser();
  for (let i = 0; i < text.length; i += chunkSize) parser.push(text.slice(i, i + chunkSize));
  return parser.end();
}

function byPath(summary: DiffSummary, path: string) {
  const file = summary.files.find((f) => f.path === path);
  if (!file) throw new Error(`missing ${path}: ${summary.files.map((f) => f.path).join(', ')}`);
  return file;
}

describe('createDiffParser on the edge-case fixture', () => {
  const summary = parseAll(EDGE);

  it('finds every file with the right totals', () => {
    expect(summary.files.map((f) => f.path)).toEqual([
      'src/app.ts',
      'README.md',
      'old.txt',
      'docs/b.md',
      'pure-new.txt',
      'img/logo.png',
      'img/icon.png',
      'bin/run.sh',
      'vendor/lib',
      'sp ace/café.txt',
      'empty.txt',
      'copy-dst.txt',
      'with space/x b/y.txt',
    ]);
    expect(summary.additions).toBe(8);
    expect(summary.deletions).toBe(6);
  });

  it('counts hunk lines and ignores the no-newline marker', () => {
    expect(byPath(summary, 'src/app.ts')).toMatchObject({
      status: 'modified',
      additions: 2,
      deletions: 1,
      binary: false,
    });
  });

  it('does not mistake content lines starting with --- or +++ for headers', () => {
    expect(byPath(summary, 'README.md')).toMatchObject({ status: 'added', additions: 2, deletions: 0 });
    expect(byPath(summary, 'old.txt')).toMatchObject({ status: 'removed', additions: 0, deletions: 2 });
  });

  it('handles renames with and without content changes', () => {
    expect(byPath(summary, 'docs/b.md')).toMatchObject({
      status: 'renamed',
      oldPath: 'docs/a.md',
      additions: 1,
      deletions: 1,
    });
    expect(byPath(summary, 'pure-new.txt')).toMatchObject({
      status: 'renamed',
      oldPath: 'pure-old.txt',
      additions: 0,
      deletions: 0,
    });
  });

  it('flags binaries and skips binary patch payloads', () => {
    expect(byPath(summary, 'img/logo.png')).toMatchObject({ status: 'added', binary: true, additions: 0 });
    expect(byPath(summary, 'img/icon.png')).toMatchObject({
      status: 'modified',
      binary: true,
      additions: 0,
      deletions: 0,
    });
  });

  it('reports mode-only changes and empty files with zero counts', () => {
    expect(byPath(summary, 'bin/run.sh')).toMatchObject({ status: 'modified', additions: 0, deletions: 0 });
    expect(byPath(summary, 'empty.txt')).toMatchObject({ status: 'added', additions: 0, deletions: 0 });
  });

  it('counts submodule pointer changes as one and one', () => {
    expect(byPath(summary, 'vendor/lib')).toMatchObject({ additions: 1, deletions: 1 });
  });

  it('decodes quoted paths with octal UTF-8 escapes', () => {
    expect(byPath(summary, 'sp ace/café.txt')).toMatchObject({ additions: 1, deletions: 0 });
  });

  it('records copies', () => {
    expect(byPath(summary, 'copy-dst.txt')).toMatchObject({ status: 'copied', oldPath: 'copy-src.txt' });
  });

  it('splits unquoted headers whose path contains " b/"', () => {
    expect(byPath(summary, 'with space/x b/y.txt')).toMatchObject({ additions: 1, deletions: 1 });
  });
});

describe('createDiffParser streaming behaviour', () => {
  it('produces identical output for any chunk size', () => {
    const whole = parseAll(EDGE);
    for (const size of [1, 7, 4096]) expect(parseAll(EDGE, size)).toEqual(whole);
  });

  it('accepts CRLF input', () => {
    expect(parseAll(EDGE.replace(/\n/g, '\r\n'))).toEqual(parseAll(EDGE));
  });

  it('keeps the files seen so far when the input is truncated', () => {
    const cut = EDGE.indexOf('+--- not a header');
    const summary = parseAll(EDGE.slice(0, cut));
    expect(summary.files).toHaveLength(2);
    expect(summary.files[1]).toMatchObject({ path: 'README.md', status: 'added', additions: 1 });
  });

  it('exposes the in-progress file through current()', () => {
    const parser = createDiffParser();
    parser.push('diff --git a/x.txt b/x.txt\n--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-a\n+b\n+c');
    expect(parser.current().files).toEqual([
      { path: 'x.txt', status: 'modified', additions: 1, deletions: 1, binary: false },
    ]);
    const final = parser.end();
    expect(final.files[0]).toMatchObject({ additions: 2, deletions: 1 });
    expect(parser.end()).toEqual(final);
  });
});

describe('createDiffParser on the captured Express compare', () => {
  const summary = parseAll(EXPRESS);

  it("matches GitHub's own summary numbers", () => {
    expect(summary.files).toHaveLength(29);
    expect(summary.additions).toBe(611);
    expect(summary.deletions).toBe(167);
  });

  it('classifies statuses', () => {
    const counts = summary.files.reduce<Record<string, number>>((acc, f) => {
      acc[f.status] = (acc[f.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ added: 1, removed: 1, modified: 27 });
    expect(summary.files[0]?.path).toBe('.github/workflows/ci.yml');
  });
});

describe('splitHeaderPaths', () => {
  it('splits the symmetric case', () => {
    expect(splitHeaderPaths('a/src/index.ts b/src/index.ts')).toEqual({
      a: 'src/index.ts',
      b: 'src/index.ts',
    });
  });

  it('splits an unquoted rename', () => {
    expect(splitHeaderPaths('a/old.txt b/new name.txt')).toEqual({ a: 'old.txt', b: 'new name.txt' });
  });

  it('splits quoted and mixed forms', () => {
    expect(splitHeaderPaths('"a/caf\\303\\251.txt" "b/caf\\303\\251.txt"')).toEqual({
      a: 'café.txt',
      b: 'café.txt',
    });
    expect(splitHeaderPaths('a/plain.txt "b/tab\\there.txt"')).toEqual({
      a: 'plain.txt',
      b: 'tab\there.txt',
    });
  });

  it('returns null for garbage', () => {
    expect(splitHeaderPaths('nonsense')).toBeNull();
  });
});

describe('readQuoted', () => {
  it('decodes C escapes and reports the end index', () => {
    expect(readQuoted('"a\\"b\\\\c\\n" tail', 0)).toEqual({ value: 'a"b\\c\n', end: 11 });
  });

  it('returns null when unterminated or not quoted', () => {
    expect(readQuoted('"abc', 0)).toBeNull();
    expect(readQuoted('abc', 0)).toBeNull();
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm vitest run tests/diff-parser.test.ts`

Expected: FAIL, the import of `../src/lib/diff-parser` cannot be resolved.

- [ ] **Step 6: Write the parser**

`src/lib/diff-parser.ts`:

```ts
import type { DiffSummary, FileChange } from './types';

export interface DiffParser {
  /** Feed the next chunk of diff text. Chunks may split lines anywhere. */
  push(chunk: string): void;
  /** Flush the last partial line and return the final summary. Idempotent. */
  end(): DiffSummary;
  /** Snapshot of everything parsed so far, including the file in progress. */
  current(): DiffSummary;
}

type Section = 'header' | 'hunk' | 'binary';

const DIFF_HEADER = 'diff --git ';

export function createDiffParser(): DiffParser {
  const files: FileChange[] = [];
  let pending = '';
  let file: FileChange | null = null;
  let section: Section = 'header';
  /** True once rename/copy lines supplied the paths; `---`/`+++` lines are then ignored. */
  let pathsAuthoritative = false;
  /** Path seen on the `--- a/...` line, used to name deleted files. */
  let minusPath: string | null = null;

  function finishFile(): void {
    if (file) files.push(file);
    file = null;
  }

  function startFile(rest: string): void {
    finishFile();
    const split = splitHeaderPaths(rest);
    file = {
      path: split ? split.b : rest,
      status: 'modified',
      additions: 0,
      deletions: 0,
      binary: false,
    };
    section = 'header';
    pathsAuthoritative = false;
    minusPath = null;
  }

  function handleLine(line: string): void {
    if (line.startsWith(DIFF_HEADER)) {
      startFile(line.slice(DIFF_HEADER.length));
      return;
    }
    if (!file) return;

    if (section === 'hunk') {
      // Inside hunks every line is content. A removed line whose text starts with "-- "
      // shows up as "--- ..." and must count as a deletion, never as a header.
      if (line.startsWith('+')) file.additions += 1;
      else if (line.startsWith('-')) file.deletions += 1;
      return;
    }
    if (section === 'binary') return;

    if (line.startsWith('@@')) {
      section = 'hunk';
      return;
    }
    if (line.startsWith('new file mode')) {
      file.status = 'added';
      return;
    }
    if (line.startsWith('deleted file mode')) {
      file.status = 'removed';
      return;
    }
    if (line.startsWith('rename from ')) {
      file.oldPath = unquotePath(line.slice('rename from '.length));
      file.status = 'renamed';
      pathsAuthoritative = true;
      return;
    }
    if (line.startsWith('rename to ')) {
      file.path = unquotePath(line.slice('rename to '.length));
      file.status = 'renamed';
      pathsAuthoritative = true;
      return;
    }
    if (line.startsWith('copy from ')) {
      file.oldPath = unquotePath(line.slice('copy from '.length));
      file.status = 'copied';
      pathsAuthoritative = true;
      return;
    }
    if (line.startsWith('copy to ')) {
      file.path = unquotePath(line.slice('copy to '.length));
      file.status = 'copied';
      pathsAuthoritative = true;
      return;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.binary = true;
      section = 'binary';
      return;
    }
    if (line.startsWith('--- ')) {
      const target = line.slice(4);
      if (target === '/dev/null') {
        if (file.status === 'modified') file.status = 'added';
      } else if (!pathsAuthoritative) {
        minusPath = stripPrefix(unquotePath(target), 'a/');
      }
      return;
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      if (target === '/dev/null') {
        file.status = 'removed';
        if (!pathsAuthoritative && minusPath !== null) file.path = minusPath;
      } else if (!pathsAuthoritative) {
        file.path = stripPrefix(unquotePath(target), 'b/');
      }
      return;
    }
    // index, old mode, new mode, similarity index, dissimilarity index: nothing to record.
  }

  function summary(includeCurrent: boolean): DiffSummary {
    const list = includeCurrent && file ? [...files, { ...file }] : [...files];
    let additions = 0;
    let deletions = 0;
    for (const f of list) {
      additions += f.additions;
      deletions += f.deletions;
    }
    return { files: list, additions, deletions };
  }

  return {
    push(chunk) {
      const data = pending + chunk;
      let start = 0;
      for (let nl = data.indexOf('\n'); nl !== -1; nl = data.indexOf('\n', start)) {
        handleLine(stripCr(data.slice(start, nl)));
        start = nl + 1;
      }
      pending = data.slice(start);
    },
    end() {
      if (pending.length > 0) {
        handleLine(stripCr(pending));
        pending = '';
      }
      finishFile();
      return summary(false);
    },
    current() {
      return summary(true);
    },
  };
}

function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function stripPrefix(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

/** Unquote a single path token. Unquoted tokens lose any trailing tab-separated metadata. */
function unquotePath(raw: string): string {
  if (raw.startsWith('"')) {
    const quoted = readQuoted(raw, 0);
    return quoted ? quoted.value : raw;
  }
  const tab = raw.indexOf('\t');
  return tab === -1 ? raw : raw.slice(0, tab);
}

const ESCAPES: Record<string, number> = {
  n: 10,
  t: 9,
  r: 13,
  a: 7,
  b: 8,
  f: 12,
  v: 11,
  '"': 34,
  '\\': 92,
};

/**
 * Parse a C-style quoted string starting at `s[start] === '"'`, as git emits for paths with
 * unusual characters. Octal escapes are raw UTF-8 bytes. Returns the decoded value and the
 * index just past the closing quote, or null when the token is not a complete quoted string.
 */
export function readQuoted(s: string, start: number): { value: string; end: number } | null {
  if (s[start] !== '"') return null;
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer) {
      bytes.push(...encoder.encode(buffer));
      buffer = '';
    }
  };
  let i = start + 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      flush();
      return { value: new TextDecoder().decode(new Uint8Array(bytes)), end: i + 1 };
    }
    if (ch !== '\\') {
      buffer += ch;
      i += 1;
      continue;
    }
    const next = s[i + 1];
    if (next === undefined) return null;
    if (next >= '0' && next <= '7') {
      flush();
      let j = i + 1;
      let octal = '';
      while (j < s.length && octal.length < 3 && s[j] >= '0' && s[j] <= '7') {
        octal += s[j];
        j += 1;
      }
      bytes.push(parseInt(octal, 8));
      i = j;
      continue;
    }
    const code = ESCAPES[next];
    if (code === undefined) return null;
    flush();
    bytes.push(code);
    i += 2;
  }
  return null;
}

/**
 * Split the text after `diff --git ` into old and new paths with the `a/` and `b/` prefixes
 * removed. Unquoted paths may contain spaces, so the symmetric case `a/X b/X` is detected by
 * length; asymmetric unquoted pairs split at the last ` b/`.
 */
export function splitHeaderPaths(rest: string): { a: string; b: string } | null {
  let a: string;
  let tail: string;
  if (rest.startsWith('"')) {
    const quoted = readQuoted(rest, 0);
    if (!quoted) return null;
    a = quoted.value;
    tail = rest.slice(quoted.end).trimStart();
  } else {
    const n = rest.length;
    if (n % 2 === 1) {
      const len = (n - 5) / 2;
      if (
        len > 0 &&
        rest.startsWith('a/') &&
        rest.slice(2 + len, n - len) === ' b/' &&
        rest.slice(2, 2 + len) === rest.slice(n - len)
      ) {
        const path = rest.slice(2, 2 + len);
        return { a: path, b: path };
      }
    }
    const quotedB = rest.indexOf(' "b/');
    const cut = quotedB !== -1 ? quotedB : rest.lastIndexOf(' b/');
    if (cut <= 0) return null;
    a = rest.slice(0, cut);
    tail = rest.slice(cut + 1);
  }
  let b: string;
  if (tail.startsWith('"')) {
    const quoted = readQuoted(tail, 0);
    if (!quoted) return null;
    b = quoted.value;
  } else {
    b = tail;
  }
  return { a: stripPrefix(a, 'a/'), b: stripPrefix(b, 'b/') };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run tests/diff-parser.test.ts`

Expected: PASS, all tests green. If `splits unquoted headers whose path contains " b/"` fails, check that the fixture's last file header is exactly `diff --git a/with space/x b/y.txt b/with space/x b/y.txt` (45 characters after `diff --git `).

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck`

Expected: exit 0.

```bash
git add src/lib/types.ts src/lib/diff-parser.ts tests/diff-parser.test.ts tests/fixtures
git commit -m "feat: add streaming unified diff parser"
```

---

### Task 3: Tree builder

**Files:**
- Create: `src/lib/tree.ts`
- Test: `tests/tree.test.ts`

**Interfaces:**
- Consumes: `FileChange`, `DirNode`, `FileNode`, `TreeNode` from `src/lib/types.ts`.
- Produces: `buildTree(files: FileChange[]): DirNode`. The root has `name: ''` and `path: ''`; every directory carries rollups `files`, `additions`, `deletions`; children are sorted directories first, then files, both with a numeric, case-insensitive collator.

- [ ] **Step 1: Write the failing tests**

`tests/tree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildTree } from '../src/lib/tree';
import type { DirNode, FileChange, FileNode } from '../src/lib/types';

const change = (
  path: string,
  additions = 0,
  deletions = 0,
  extra: Partial<FileChange> = {},
): FileChange => ({ path, status: 'modified', additions, deletions, binary: false, ...extra });

const names = (node: DirNode): string[] =>
  node.children.map((c) => (c.kind === 'dir' ? `${c.name}/` : c.name));

function dir(node: DirNode, name: string): DirNode {
  const found = node.children.find((c) => c.kind === 'dir' && c.name === name);
  if (!found || found.kind !== 'dir') throw new Error(`no directory ${name}`);
  return found;
}

describe('buildTree', () => {
  const root = buildTree([
    change('src/app/b.ts', 1, 2),
    change('src/app/a.ts', 3, 0),
    change('src/index.ts', 0, 5),
    change('README.md', 1, 0),
    change('Zeta/z.ts', 2, 2),
    change('assets/img10.png', 0, 0, { binary: true }),
    change('assets/img9.png', 0, 0, { binary: true }),
  ]);

  it('nests one level per directory and keeps root files at the root', () => {
    expect(names(root)).toEqual(['assets/', 'src/', 'Zeta/', 'README.md']);
    expect(names(dir(root, 'src'))).toEqual(['app/', 'index.ts']);
    expect(names(dir(dir(root, 'src'), 'app'))).toEqual(['a.ts', 'b.ts']);
  });

  it('sorts numerically and case-insensitively', () => {
    expect(names(dir(root, 'assets'))).toEqual(['img9.png', 'img10.png']);
  });

  it('rolls up counts into every directory and the root', () => {
    expect(root).toMatchObject({ path: '', files: 7, additions: 7, deletions: 9 });
    expect(dir(root, 'src')).toMatchObject({ path: 'src', files: 3, additions: 4, deletions: 7 });
    expect(dir(dir(root, 'src'), 'app')).toMatchObject({
      path: 'src/app',
      files: 2,
      additions: 4,
      deletions: 2,
    });
  });

  it('exposes the change on file nodes', () => {
    const readme = root.children.find((c): c is FileNode => c.kind === 'file');
    expect(readme?.path).toBe('README.md');
    expect(readme?.change).toEqual(change('README.md', 1, 0));
  });

  it('replaces duplicates instead of listing them twice', () => {
    const tree = buildTree([change('a.txt', 1, 0), change('a.txt', 5, 5)]);
    expect(tree.children).toHaveLength(1);
    expect(tree).toMatchObject({ files: 1, additions: 5, deletions: 5 });
  });

  it('returns an empty root for no files', () => {
    expect(buildTree([])).toEqual({
      kind: 'dir',
      name: '',
      path: '',
      children: [],
      files: 0,
      additions: 0,
      deletions: 0,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/tree.test.ts`

Expected: FAIL, cannot resolve `../src/lib/tree`.

- [ ] **Step 3: Write the tree builder**

`src/lib/tree.ts`:

```ts
import type { DirNode, FileChange, FileNode, TreeNode } from './types';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Nest changed files into a folder tree, one level per directory, with rollups on every folder. */
export function buildTree(files: FileChange[]): DirNode {
  const root = makeDir('', '');
  const dirs = new Map<string, DirNode>([['', root]]);
  const placed = new Map<string, { parent: DirNode; node: FileNode }>();

  for (const change of files) {
    const segments = change.path.split('/');
    const name = segments.pop() ?? change.path;
    let parent = root;
    let path = '';
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let dir = dirs.get(path);
      if (!dir) {
        dir = makeDir(segment, path);
        dirs.set(path, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
    const node: FileNode = { kind: 'file', name, path: change.path, change };
    const existing = placed.get(change.path);
    if (existing) {
      const index = existing.parent.children.indexOf(existing.node);
      existing.parent.children[index] = node;
    } else {
      parent.children.push(node);
    }
    placed.set(change.path, { parent, node });
  }

  rollup(root);
  sortChildren(root);
  return root;
}

function makeDir(name: string, path: string): DirNode {
  return { kind: 'dir', name, path, children: [], files: 0, additions: 0, deletions: 0 };
}

function rollup(dir: DirNode): void {
  dir.files = 0;
  dir.additions = 0;
  dir.deletions = 0;
  for (const child of dir.children) {
    if (child.kind === 'dir') {
      rollup(child);
      dir.files += child.files;
      dir.additions += child.additions;
      dir.deletions += child.deletions;
    } else {
      dir.files += 1;
      dir.additions += child.change.additions;
      dir.deletions += child.change.deletions;
    }
  }
}

function sortChildren(dir: DirNode): void {
  dir.children.sort(compareNodes);
  for (const child of dir.children) if (child.kind === 'dir') sortChildren(child);
}

function compareNodes(x: TreeNode, y: TreeNode): number {
  if (x.kind !== y.kind) return x.kind === 'dir' ? -1 : 1;
  return collator.compare(x.name, y.name);
}
```

The collator is pinned to `en` rather than the browser locale so ordering is identical in tests and in every user's browser; file names are paths, not prose, so a locale-specific order would not help anyone.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/tree.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tree.ts tests/tree.test.ts
git commit -m "feat: build folder tree with per-folder rollups"
```

---

### Task 4: Page adapter, URL rules and anchors

**Files:**
- Create: `src/lib/page.ts` (URL half; Task 5 adds the DOM half to the same file)
- Test: `tests/page-url.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `src/lib/page.ts`):
  - `interface CompareParts { owner: string; repo: string; range: string }`
  - `parseCompareUrl(url: string): CompareParts | null`
  - `diffUrl(parts: CompareParts, origin: string): string`
  - `compareKey(parts: CompareParts): string`
  - `anchorFor(path: string): Promise<string>` returning `diff-` plus 64 hex characters
  - constants `SELECTORS`, `HOST_TAG = 'compare-tree-sidebar'`, `OPEN_ATTR = 'data-ctg-open'`, `PAGE_STYLE_ID = 'ctg-page-style'`, `DEFAULT_STICKY_TOP = 8`

- [ ] **Step 1: Write the failing tests**

`tests/page-url.test.ts` (runs in Node; `crypto.subtle` is global in Node 20+):

```ts
import { describe, expect, it } from 'vitest';
import { anchorFor, compareKey, diffUrl, parseCompareUrl } from '../src/lib/page';

describe('parseCompareUrl', () => {
  it('parses a three-dot range with a slash in the branch name, ignoring query and hash', () => {
    expect(
      parseCompareUrl(
        'https://github.com/volvo-cars/mfg-cws/compare/master...feature/atacq-upload-app-atacq-tab?expand=1#files_bucket',
      ),
    ).toEqual({
      owner: 'volvo-cars',
      repo: 'mfg-cws',
      range: 'master...feature/atacq-upload-app-atacq-tab',
    });
  });

  it('parses tags with dots and two-dot ranges', () => {
    expect(parseCompareUrl('https://github.com/expressjs/express/compare/4.18.2...4.19.2')?.range).toBe(
      '4.18.2...4.19.2',
    );
    expect(parseCompareUrl('https://github.com/o/r/compare/a..b')?.range).toBe('a..b');
  });

  it('keeps fork prefixes and encoded characters untouched', () => {
    expect(parseCompareUrl('https://github.com/o/r/compare/main...someone:fork:feature%2Fx')?.range).toBe(
      'main...someone:fork:feature%2Fx',
    );
  });

  it('strips trailing slashes', () => {
    expect(parseCompareUrl('https://github.com/o/r/compare/main...dev/')?.range).toBe('main...dev');
  });

  it('returns null for bare compare pages and other pages', () => {
    expect(parseCompareUrl('https://github.com/o/r/compare')).toBeNull();
    expect(parseCompareUrl('https://github.com/o/r/compare/')).toBeNull();
    expect(parseCompareUrl('https://github.com/o/r/pull/1/files')).toBeNull();
    expect(parseCompareUrl('not a url')).toBeNull();
  });
});

describe('diffUrl and compareKey', () => {
  const parts = { owner: 'o', repo: 'r', range: 'main...feature/x' };

  it('appends .diff to the compare path on the given origin', () => {
    expect(diffUrl(parts, 'https://github.com')).toBe(
      'https://github.com/o/r/compare/main...feature/x.diff',
    );
  });

  it('builds a stable key', () => {
    expect(compareKey(parts)).toBe('o/r/main...feature/x');
  });
});

describe('anchorFor', () => {
  it.each([
    [
      '.github/workflows/ci.yml',
      'diff-b803fcb7f17ed9235f1e5cb1fcd2f5d3b2838429d4368ae4c57ce4436577f03f',
    ],
    ['Contributing.md', 'diff-1246fcebc419eba2aaf5b810ef51db6ec5606f34da054746e1b31bdd7378405d'],
    ['History.md', 'diff-abfa5988643af1b8b2600aac13b273922dbb3372e021bf1d7caadfe7473c9561'],
    [
      'patches/chokidar@3.6.0.patch',
      'diff-e30bf28f21a7a6699eff3322122ef8c62a049ab8145f9d2aa2f9ee929a139774',
    ],
  ])('hashes %s the way GitHub does', async (path, anchor) => {
    await expect(anchorFor(path)).resolves.toBe(anchor);
  });
});
```

The four anchors were captured from live GitHub pages; the last one is a renamed file, proving GitHub hashes the new path.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/page-url.test.ts`

Expected: FAIL, cannot resolve `../src/lib/page`.

- [ ] **Step 3: Write the URL half of the adapter**

`src/lib/page.ts` (Task 5 appends the DOM functions below these):

```ts
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
  const range = match[3].replace(/\/+$/, '');
  if (!range) return null;
  return { owner: match[1], repo: match[2], range };
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/page-url.test.ts`

Expected: PASS, including all four anchor vectors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/page.ts tests/page-url.test.ts
git commit -m "feat: parse compare URLs and compute GitHub diff anchors"
```

---

### Task 5: Page adapter, DOM half

**Files:**
- Modify: `src/lib/page.ts` (append)
- Create: `tests/helpers/page-dom.ts`
- Test: `tests/page-dom.test.ts`

**Interfaces:**
- Consumes: constants and `anchorFor` from Task 4.
- Produces (exported from `src/lib/page.ts`):
  - `interface DiffRoot { bucket: HTMLElement; diff: HTMLElement; files: HTMLElement }`, `findDiffRoot(doc?: Document): DiffRoot | null`
  - `waitFor(selector: string, options?: { timeoutMs?: number; signal?: AbortSignal; doc?: Document }): Promise<Element>` rejecting with an `Error` whose message starts `Timed out` or a `DOMException` named `AbortError`
  - `readTabFileCount(doc?: Document): number | null`
  - `ensurePageStyle(doc?: Document): void`, `applyLayout(bucket: HTMLElement, open: boolean): void`, `removeLayout(bucket: HTMLElement): void`, `setStickyTop(bucket: HTMLElement, px: number): void`, `measureStickyTop(doc?: Document, win?: Window): number`, `removeStaleHosts(doc?: Document): void`
  - `scrollToFile(path: string, options: { files: Element; signal?: AbortSignal; timeoutMs?: number; stickyTop?: number; doc?: Document; win?: Window }): Promise<boolean>`
  - `observeActiveFile(files: Element, onChange: (path: string | null) => void, win?: Window): () => void`
- Test helper: `installComparePage(doc, { tabCount?, paths? })` returning `{ bucket, files, container }` and `fileElement(doc, path, id?)`.

- [ ] **Step 1: Write the DOM fixture helper**

`tests/helpers/page-dom.ts` mirrors the structure captured from the real compare page:

```ts
export interface InstalledPage {
  bucket: HTMLElement;
  files: HTMLElement;
  /** GitHub's progressive container that receives file diffs. */
  container: HTMLElement;
}

export function installComparePage(
  doc: Document,
  options: { tabCount?: number | string; paths?: string[] } = {},
): InstalledPage {
  const { tabCount = 29, paths = [] } = options;
  doc.body.innerHTML = `
    <div id="repo-content-pjax-container" class="repository-content">
      <div class="clearfix new-discussion-timeline container-xl">
        <nav class="tabnav">
          <a class="tabnav-tab js-compare-tab selected" href="#commits_bucket">Commits <span class="Counter">59</span></a>
          <a class="tabnav-tab js-compare-tab" href="#files_bucket">Files changed
            <span class="Counter">${tabCount}</span></a>
        </nav>
        <div id="commits_bucket"></div>
        <div id="files_bucket" class="files-bucket d-none">
          <div class="container-xl">
            <div id="diff" class="uncommentable">
              <div id="toc" class="table-of-contents">
                <div class="toc-diff-stats">Showing <strong>${tabCount} changed files</strong></div>
              </div>
              <template class="js-comment-button-template"></template>
              <div id="files" class="diff-view js-diff-container">
                <div class="js-diff-progressive-container"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  const container = doc.querySelector<HTMLElement>('.js-diff-progressive-container')!;
  for (const path of paths) container.appendChild(fileElement(doc, path));
  return {
    bucket: doc.getElementById('files_bucket')!,
    files: doc.getElementById('files')!,
    container,
  };
}

/** One file diff as GitHub renders it: container with the anchor id, header with data-path. */
export function fileElement(doc: Document, path: string, id?: string): HTMLElement {
  const file = doc.createElement('div');
  file.className = 'file js-file';
  if (id) file.id = id;
  file.dataset.tagsearchPath = path;
  const header = doc.createElement('div');
  header.className = 'file-header';
  header.dataset.path = path;
  file.appendChild(header);
  return file;
}
```

- [ ] **Step 2: Write the failing tests**

`tests/page-dom.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOST_TAG,
  OPEN_ATTR,
  PAGE_STYLE_ID,
  anchorFor,
  applyLayout,
  findDiffRoot,
  measureStickyTop,
  observeActiveFile,
  readTabFileCount,
  removeLayout,
  removeStaleHosts,
  scrollToFile,
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
    await expect(waitFor('#files', { doc: document })).resolves.toBe(document.getElementById('files'));
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
    const pending = waitFor('#never', { doc: document, timeoutMs: 1000, signal: controller.signal });
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
    expect(document.getElementById(PAGE_STYLE_ID)?.textContent).toContain(`[${OPEN_ATTR}]`);
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

describe('scrollToFile', () => {
  it('scrolls to an existing diff and updates the hash', async () => {
    const path = 'src/index.ts';
    const anchor = await anchorFor(path);
    const { files, container } = installComparePage(document);
    container.appendChild(fileElement(document, path, anchor));
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    await expect(scrollToFile(path, { files, doc: document, win: window })).resolves.toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
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
    ({ target, isIntersecting, boundingClientRect: { top } }) as unknown as IntersectionObserverEntry;

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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run tests/page-dom.test.ts`

Expected: FAIL, the DOM functions are not exported from `../src/lib/page`.

- [ ] **Step 4: Append the DOM half to page.ts**

Append to `src/lib/page.ts`:

```ts
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
  const match = /files changed\D*(\d[\d,. ]*)/i.exec(tab?.textContent ?? '');
  if (!match) return null;
  const digits = match[1].replace(/\D/g, '');
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
    if ((style.position === 'sticky' || style.position === 'fixed') && parseFloat(style.top) === 0) {
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

/**
 * Report which file header sits nearest the top of the viewport. The zone is the top 20% of
 * the viewport; when it holds no header (the reader is inside a long diff) the last file stays
 * active. Headers streamed in later are picked up automatically.
 */
export function observeActiveFile(
  files: Element,
  onChange: (path: string | null) => void,
  win: Window = window,
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/page-dom.test.ts tests/page-url.test.ts`

Expected: PASS for both files. If jsdom prints `Not implemented: window.scrollTo`, a test forgot to stub `window.scrollTo`; every `scrollToFile` test that can reach the scroll must stub it.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck`

Expected: exit 0.

```bash
git add src/lib/page.ts tests/page-dom.test.ts tests/helpers/page-dom.ts
git commit -m "feat: add GitHub page adapter for layout, waiting, scrolling, and active file"
```

---

### Task 6: Icons, stylesheet, and the sidebar renderer

**Files:**
- Create: `src/lib/icons.ts`
- Create: `src/assets/sidebar.css`
- Create: `src/lib/render.ts`
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: `DirNode`, `FileNode`, `TreeNode`, `SidebarState` from `types.ts`; `buildTree` in tests.
- Produces (from `src/lib/render.ts`):

```ts
export interface Sidebar {
  setOpen(open: boolean): void;                          // panel shown vs slim "Show file tree" bar
  setState(state: SidebarState): void;                   // loading / ready (optional warning) / error
  setTree(root: DirNode): void;                          // full render, all directories expanded
  setActive(path: string | null): void;                  // highlight the file under the viewport top
  onToggleOpen(cb: (open: boolean) => void): void;
  onSelectFile(cb: (path: string) => Promise<boolean>): void;
  onRetry(cb: () => void): void;
}
export function createSidebar(container: HTMLElement): Sidebar;
export function formatBytes(n: number): string;          // '500 B', '45 KB', '1.2 MB'
```

  and `ICONS` from `src/lib/icons.ts` with keys `chevronDown`, `folder`, `added`, `modified`, `removed`, `renamed`, `sidebarCollapse`, `sidebarExpand`, `fold`, `unfold`.

- [ ] **Step 1: Write the icons module**

`src/lib/icons.ts`. Path data is copied verbatim from Primer Octicons (MIT), 16 px set.

```ts
const svg = (body: string): string =>
  `<svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="16" height="16">${body}</svg>`;

/** Octicons (MIT, github.com/primer/octicons), inlined so the sidebar ships no extra assets. */
export const ICONS = {
  chevronDown: svg(
    '<path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z"/>',
  ),
  folder: svg(
    '<path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/>',
  ),
  added: svg(
    '<path d="M2.75 1h10.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1Zm10.5 1.5H2.75a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM8 4a.75.75 0 0 1 .75.75v2.5h2.5a.75.75 0 0 1 0 1.5h-2.5v2.5a.75.75 0 0 1-1.5 0v-2.5h-2.5a.75.75 0 0 1 0-1.5h2.5v-2.5A.75.75 0 0 1 8 4Z"/>',
  ),
  modified: svg(
    '<path d="M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"/>',
  ),
  removed: svg(
    '<path d="M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Zm8.5 6.25h-6.5a.75.75 0 0 1 0-1.5h6.5a.75.75 0 0 1 0 1.5Z"/>',
  ),
  renamed: svg(
    '<path d="M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Zm9.03 6.03-3.25 3.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l1.97-1.97H4.75a.75.75 0 0 1 0-1.5h4.69L7.47 5.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l3.25 3.25a.75.75 0 0 1 0 1.06Z"/>',
  ),
  sidebarCollapse: svg(
    '<path d="M6.823 7.823a.25.25 0 0 1 0 .354l-2.396 2.396A.25.25 0 0 1 4 10.396V5.604a.25.25 0 0 1 .427-.177Z"/><path d="M1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25V1.75C0 .784.784 0 1.75 0ZM1.5 1.75v12.5c0 .138.112.25.25.25H9.5v-13H1.75a.25.25 0 0 0-.25.25ZM11 14.5h3.25a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25H11Z"/>',
  ),
  sidebarExpand: svg(
    '<path d="m4.177 7.823 2.396-2.396A.25.25 0 0 1 7 5.604v4.792a.25.25 0 0 1-.427.177L4.177 8.177a.25.25 0 0 1 0-.354Z"/><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25H9.5v-13Zm12.5 13a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25H11v13Z"/>',
  ),
  fold: svg(
    '<path d="M10.896 2H8.75V.75a.75.75 0 0 0-1.5 0V2H5.104a.25.25 0 0 0-.177.427l2.896 2.896a.25.25 0 0 0 .354 0l2.896-2.896A.25.25 0 0 0 10.896 2ZM8.75 15.25a.75.75 0 0 1-1.5 0V14H5.104a.25.25 0 0 1-.177-.427l2.896-2.896a.25.25 0 0 1 .354 0l2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25Zm-6.5-6.5a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z"/>',
  ),
  unfold: svg(
    '<path d="m8.177.677 2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25a.75.75 0 0 1-1.5 0V4H5.104a.25.25 0 0 1-.177-.427L7.823.677a.25.25 0 0 1 .354 0ZM7.25 10.75a.75.75 0 0 1 1.5 0V12h2.146a.25.25 0 0 1 .177.427l-2.896 2.896a.25.25 0 0 1-.354 0l-2.896-2.896A.25.25 0 0 1 5.104 12H7.25v-1.25Zm-5-2a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z"/>',
  ),
} as const;
```

- [ ] **Step 2: Write the stylesheet**

`src/assets/sidebar.css`. It is injected into the shadow root by WXT (`cssInjectionMode: 'ui'`). WXT resets inherited properties inside the shadow root, but CSS custom properties are not affected by that reset, so GitHub's Primer variables still reach these rules and switch with the user's theme.

```css
:host {
  display: block;
}

.ctg-root {
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif,
    'Apple Color Emoji', 'Segoe UI Emoji';
  font-size: 12px;
  line-height: 1.5;
  color: var(--fgColor-default, #1f2328);
  box-sizing: border-box;
}

.ctg-root *,
.ctg-root *::before,
.ctg-root *::after {
  box-sizing: inherit;
}

[hidden] {
  display: none !important;
}

.ctg-panel {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 6px;
  background: var(--bgColor-default, #fff);
}

.ctg-header {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px;
  background: var(--bgColor-default, #fff);
  border-bottom: 1px solid var(--borderColor-default, #d1d9e0);
}

.ctg-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ctg-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.ctg-totals {
  margin-left: auto;
  color: var(--fgColor-muted, #59636e);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ctg-add {
  color: var(--fgColor-success, #1a7f37);
}

.ctg-del {
  color: var(--fgColor-danger, #d1242f);
}

.ctg-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}

.ctg-btn,
.ctg-icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--fgColor-muted, #59636e);
  font: inherit;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
}

.ctg-icon-btn {
  padding: 2px;
}

.ctg-btn:hover,
.ctg-icon-btn:hover {
  background: var(--bgColor-muted, #f6f8fa);
  color: var(--fgColor-default, #1f2328);
}

.ctg-btn:focus-visible,
.ctg-icon-btn:focus-visible,
.ctg-row:focus-visible {
  outline: 2px solid var(--fgColor-accent, #0969da);
  outline-offset: -2px;
}

.ctg-root svg {
  flex: none;
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.ctg-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: var(--fgColor-muted, #59636e);
}

.ctg-status:empty {
  display: none;
}

.ctg-status.ctg-error {
  color: var(--fgColor-danger, #d1242f);
}

.ctg-status.ctg-warning {
  color: var(--fgColor-attention, #9a6700);
}

.ctg-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--borderColor-default, #d1d9e0);
  border-top-color: var(--fgColor-accent, #0969da);
  border-radius: 50%;
  animation: ctg-spin 0.8s linear infinite;
}

@keyframes ctg-spin {
  to {
    transform: rotate(360deg);
  }
}

.ctg-tree,
.ctg-group {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ctg-tree {
  padding: 4px 0;
}

.ctg-dir[aria-expanded='false'] > .ctg-group {
  display: none;
}

.ctg-dir[aria-expanded='false'] > .ctg-row .ctg-chevron svg {
  transform: rotate(-90deg);
}

.ctg-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: 26px;
  padding: 0 8px 0 calc(8px + var(--ctg-depth, 0) * 16px);
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.ctg-row:hover {
  background: var(--bgColor-muted, #f6f8fa);
}

.ctg-row.ctg-active {
  background: var(--bgColor-muted, #f6f8fa);
  box-shadow: inset 2px 0 0 var(--fgColor-accent, #0969da);
  font-weight: 600;
}

.ctg-chevron svg {
  transition: transform 80ms ease-out;
}

.ctg-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctg-meta {
  display: inline-flex;
  gap: 6px;
  margin-left: auto;
  color: var(--fgColor-muted, #59636e);
  font-size: 11px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ctg-icon-dir {
  color: var(--fgColor-muted, #59636e);
}

.ctg-icon-added {
  color: var(--fgColor-success, #1a7f37);
}

.ctg-icon-removed {
  color: var(--fgColor-danger, #d1242f);
}

.ctg-icon-modified {
  color: var(--fgColor-attention, #9a6700);
}

.ctg-icon-renamed,
.ctg-icon-copied {
  color: var(--fgColor-muted, #59636e);
}

.ctg-row.ctg-busy .ctg-meta {
  visibility: hidden;
}

.ctg-row.ctg-busy::after {
  content: '';
  position: absolute;
  right: 8px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--borderColor-default, #d1d9e0);
  border-top-color: var(--fgColor-accent, #0969da);
  border-radius: 50%;
  animation: ctg-spin 0.8s linear infinite;
}

.ctg-row {
  position: relative;
}

.ctg-bar {
  padding: 4px 0 8px;
}
```

- [ ] **Step 3: Write the failing renderer tests**

`tests/render.test.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm vitest run tests/render.test.ts`

Expected: FAIL, cannot resolve `../src/lib/render`.

- [ ] **Step 5: Write the renderer**

`src/lib/render.ts`:

```ts
import { ICONS } from './icons';
import type { DirNode, FileNode, SidebarState, TreeNode } from './types';

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
    tree.querySelectorAll('.ctg-dir').forEach((li) => li.setAttribute('aria-expanded', String(expanded)));
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
      `<span class="ctg-icon ctg-icon-${change.status}">${icon}</span>` +
      `<span class="ctg-name"></span>` +
      `<span class="ctg-meta"></span>`;
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
```

Only constant icon markup goes through `innerHTML`; every name, path, and count is set with `textContent`, so nothing from the diff can inject markup.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run tests/render.test.ts`

Expected: PASS. jsdom does not implement `scrollIntoView`, which is why `setActive` checks for the function before calling it.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck`

Expected: exit 0.

```bash
git add src/lib/icons.ts src/lib/render.ts src/assets/sidebar.css tests/render.test.ts
git commit -m "feat: render the changed-files sidebar"
```

---

### Task 7: Preferences

**Files:**
- Create: `src/lib/prefs.ts`
- Test: `tests/prefs.test.ts`

**Interfaces:**
- Consumes: `storage` from `#imports` (WXT storage, backed by `browser.storage.local`; the `storage` permission is already in the manifest).
- Produces: `interface Prefs { getSidebarOpen(): Promise<boolean>; setSidebarOpen(open: boolean): Promise<void> }` and the singleton `prefs: Prefs`.

- [ ] **Step 1: Write the failing test**

`tests/prefs.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { prefs } from '../src/lib/prefs';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('prefs', () => {
  it('defaults the sidebar to open', async () => {
    await expect(prefs.getSidebarOpen()).resolves.toBe(true);
  });

  it('persists the sidebar state in local extension storage', async () => {
    await prefs.setSidebarOpen(false);
    await expect(prefs.getSidebarOpen()).resolves.toBe(false);
    await expect(fakeBrowser.storage.local.get('sidebarOpen')).resolves.toEqual({ sidebarOpen: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/prefs.test.ts`

Expected: FAIL, cannot resolve `../src/lib/prefs`.

- [ ] **Step 3: Write the module**

`src/lib/prefs.ts`:

```ts
import { storage } from '#imports';

const sidebarOpenItem = storage.defineItem<boolean>('local:sidebarOpen', { fallback: true });

export interface Prefs {
  getSidebarOpen(): Promise<boolean>;
  setSidebarOpen(open: boolean): Promise<void>;
}

export const prefs: Prefs = {
  getSidebarOpen: () => sidebarOpenItem.getValue(),
  setSidebarOpen: (open) => sidebarOpenItem.setValue(open),
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/prefs.test.ts`

Expected: PASS. The `WxtVitest` plugin swaps `browser` for the in-memory fake, so no mocking is needed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefs.ts tests/prefs.test.ts
git commit -m "feat: persist sidebar open state"
```

---

### Task 8: Controller (lifecycle, fetch, and error states)

**Files:**
- Create: `src/lib/controller.ts`
- Test: `tests/controller.test.ts`

**Interfaces:**
- Consumes: `createDiffParser` (Task 2), `buildTree` (Task 3), everything exported from `page.ts` (Tasks 4 and 5), `Sidebar` (Task 6), `Prefs` (Task 7).
- Produces (from `src/lib/controller.ts`):

```ts
export interface MountedSidebar { sidebar: Sidebar; unmount(): void }
export interface ControllerDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  prefs: Prefs;
  mount: (anchor: Element) => Promise<MountedSidebar>;   // create the UI immediately before `anchor`
  doc?: Document; win?: Window; version?: string;
  log?: (message: string, error?: unknown) => void;
  waitTimeoutMs?: number;                                  // default 15000
}
export interface Controller { sync(url: string): Promise<void>; dispose(): void; readonly key: string | null }
export function createController(deps: ControllerDeps): Controller;
```

  Error copy used verbatim by tests: `GitHub did not return a diff. Are you signed in with access to this repository?`, `GitHub returned {status} for the diff.`, `Could not load the diff. Check your connection and retry.`, and the warning `GitHub reports {N} files, the diff contained {M}.`

- [ ] **Step 1: Write the failing tests**

`tests/controller.test.ts`:

```ts
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createController, type Controller, type MountedSidebar } from '../src/lib/controller';
import { HOST_TAG, OPEN_ATTR, PAGE_STYLE_ID } from '../src/lib/page';
import type { Prefs } from '../src/lib/prefs';
import type { Sidebar } from '../src/lib/render';
import type { DirNode, SidebarState } from '../src/lib/types';
import { installComparePage } from './helpers/page-dom';

const EDGE = readFileSync(new URL('./fixtures/edge-cases.diff', import.meta.url), 'utf8');
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
let fetchMock: ReturnType<typeof vi.fn>;
let controller: Controller | null;

function makeController(prefs: Prefs = memoryPrefs(), respond?: () => Response): Controller {
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
    log: vi.fn(),
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

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${window.location.origin}/o/r/compare/main...feature/a.diff`,
    );
    expect(spies).toHaveLength(1);
    const spy = spies[0];
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
    expect(spies[0].states.at(-1)).toEqual({
      kind: 'ready',
      warning: 'GitHub reports 29 files, the diff contained 13.',
    });
  });

  it('respects a closed preference and persists toggles', async () => {
    const { bucket } = installComparePage(document, { tabCount: 13 });
    const prefs = memoryPrefs(false);
    controller = makeController(prefs);
    await controller.sync(URL_A);
    expect(spies[0].open).toEqual([false]);
    expect(bucket.hasAttribute(OPEN_ATTR)).toBe(false);

    spies[0].toggle!(true);
    expect(bucket.hasAttribute(OPEN_ATTR)).toBe(true);
    expect(spies[0].open).toEqual([false, true]);
    await vi.waitFor(() => expect(prefs.value).toBe(true));
  });

  it('routes file selection through the page adapter', async () => {
    installComparePage(document, { tabCount: 13 });
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    controller = makeController();
    await controller.sync(URL_A);
    // The diff for this path never streams in, so the jump resolves false after the timeout.
    await expect(
      Promise.race([
        spies[0].select!('never/streamed.ts'),
        new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 50)),
      ]),
    ).resolves.toBe('pending');
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

  it('remounts for a different compare and removes the old sidebar', async () => {
    installComparePage(document, { tabCount: 13 });
    controller = makeController();
    await controller.sync(URL_A);
    await controller.sync(URL_B);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(spies[0].unmounted).toBe(true);
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1);
    expect(controller.key).toBe('o/r/main...feature/b');
  });

  it('unmounts when leaving compare pages', async () => {
    const { bucket } = installComparePage(document, { tabCount: 13 });
    controller = makeController();
    await controller.sync(URL_A);
    await controller.sync('https://github.com/o/r/pulls');
    expect(spies[0].unmounted).toBe(true);
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
    const spy = spies[0];
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
    expect(spies[0].states.at(-1)).toEqual({
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
    expect(spies[0].states.at(-1)).toEqual({
      kind: 'error',
      message: 'Could not load the diff. Check your connection and retry.',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/controller.test.ts`

Expected: FAIL, cannot resolve `../src/lib/controller`.

- [ ] **Step 3: Write the controller**

`src/lib/controller.ts`:

```ts
import { createDiffParser } from './diff-parser';
import {
  SELECTORS,
  applyLayout,
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
  setStickyTop,
  waitFor,
  type CompareParts,
} from './page';
import type { Prefs } from './prefs';
import type { Sidebar } from './render';
import { buildTree } from './tree';

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
          message: accessProblem ? ACCESS_MESSAGE : `GitHub returned ${response.status} for the diff.`,
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

      sidebar.setTree(buildTree(summary.files));
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
      return;
    }
    if (session !== s) return;

    const root = findDiffRoot(doc);
    if (!root) {
      log('The compare diff container was not found; GitHub markup may have changed');
      return;
    }
    removeStaleHosts(doc);
    s.bucket = root.bucket;
    setStickyTop(root.bucket, measureStickyTop(doc, win));

    const mounted = await deps.mount(root.files);
    if (session !== s) {
      mounted.unmount();
      return;
    }
    s.mounted = mounted;
    const { sidebar } = mounted;

    const open = await deps.prefs.getSidebarOpen();
    if (session !== s) return;
    applyLayout(root.bucket, open);
    sidebar.setOpen(open);

    sidebar.onToggleOpen((next) => {
      applyLayout(root.bucket, next);
      sidebar.setOpen(next);
      void deps.prefs.setSidebarOpen(next);
    });
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
        if (session?.key === key) return;
        teardown();
        await start(parts, key);
      } catch (error) {
        log('Unexpected error while syncing the compare tree', error);
      }
    },
    dispose() {
      teardown();
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/controller.test.ts`

Expected: PASS. If `Response` or `ReadableStream` is reported undefined, the jsdom environment is shadowing Node's globals. Do not polyfill them; check that `vitest.config.ts` sets no custom `environmentOptions` and that Node is 22 or newer, where both are built in.

- [ ] **Step 5: Run the whole suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

Expected: every test file passes; typecheck exits 0.

```bash
git add src/lib/controller.ts tests/controller.test.ts
git commit -m "feat: add compare page controller with streaming load and error states"
```

---

### Task 9: Content script wiring and manual verification

**Files:**
- Modify: `src/entrypoints/compare.content.ts` (replace the placeholder)

**Interfaces:**
- Consumes: `createController`, `createSidebar`, `prefs`, `HOST_TAG`; WXT's `defineContentScript`, `createShadowRootUi`, `browser` from `#imports`.
- Produces: the working extension. No new exports.

- [ ] **Step 1: Replace the placeholder content script**

`src/entrypoints/compare.content.ts`:

```ts
import '../assets/sidebar.css';
import { browser, createShadowRootUi, defineContentScript } from '#imports';
import { createController } from '../lib/controller';
import { HOST_TAG } from '../lib/page';
import { prefs } from '../lib/prefs';
import { createSidebar, type Sidebar } from '../lib/render';

export default defineContentScript({
  matches: ['https://github.com/*/*/compare/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    const controller = createController({
      fetch: (url, init) => fetch(url, init),
      prefs,
      version: browser.runtime.getManifest().version,
      mount: async (anchor) => {
        const created: { sidebar?: Sidebar } = {};
        const ui = await createShadowRootUi(ctx, {
          name: HOST_TAG,
          position: 'inline',
          anchor,
          append: 'before',
          onMount: (container) => {
            created.sidebar = createSidebar(container);
            return created.sidebar;
          },
        });
        ui.mount();
        const sidebar = created.sidebar;
        if (!sidebar) throw new Error('The sidebar did not mount');
        return { sidebar, unmount: () => ui.remove() };
      },
    });

    ctx.onInvalidated(() => controller.dispose());
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => {
      void controller.sync(newUrl.href);
    });
    await controller.sync(location.href);
  },
});
```

- [ ] **Step 2: Build and inspect the output**

Run:

```bash
pnpm typecheck && pnpm test && pnpm build && ls .output/chrome-mv3 .output/chrome-mv3/content-scripts && cat .output/chrome-mv3/manifest.json
```

Expected: `content-scripts/compare.js` and `content-scripts/compare.css` exist; the manifest's content script entry lists only `js`, because in `ui` mode WXT loads the CSS into the shadow root at runtime (the file is exposed through `web_accessible_resources` for that); permissions are still exactly `["storage"]`.

- [ ] **Step 3: Load the extension in Chrome**

Two options, either is fine:

1. `pnpm dev` starts WXT in watch mode and launches a separate Chrome profile with the extension installed (via `web-ext`). Sign in to GitHub in that profile to test private repositories.
2. Build once with `pnpm build`, open `chrome://extensions` in the everyday Chrome profile, enable Developer mode, click "Load unpacked", and pick `.output/chrome-mv3`. This is the profile the Chrome MCP tools can drive for screenshots.

This step needs the user: the agent cannot pick a folder in Chrome's file dialog. Ask, then continue with the checklist once loaded.

- [ ] **Step 4: Verify against live compares**

Open each page and tick every line. Where the Chrome MCP tools are available, take a screenshot per page and read the console for `[compare-tree` warnings.

- `https://github.com/expressjs/express/compare/4.18.2...4.19.2` (29 files): sidebar appears left of the diffs on the Files changed tab, header reads `29 files +611 −167`, folders `.github/workflows`, `lib`, `test` and root files present, every row has counts, no console warnings.
- Same page: click `lib/response.js` in the tree; the page scrolls to that diff and the URL hash becomes its `diff-…` anchor. Scroll the diffs slowly; the highlighted row follows.
- Same page: collapse `test`, use Collapse all and Expand all, hide the sidebar with the header button (diff area returns to GitHub's normal width, a "Show file tree" button remains), reload the page, the sidebar stays hidden, show it again.
- `https://github.com/vitejs/vite/compare/v5.0.0...v5.1.0` (475 files): header reads `475 files +13,432 −5,446`; `patches/chokidar@3.6.0.patch` shows the renamed icon with the old name in its tooltip; four binary files show `BIN`; no count-mismatch warning.
- `https://github.com/microsoft/vscode/compare/1.85.0...1.86.0` (1,579 files): the loading line shows growing megabytes for several seconds, then the tree renders; click a file deep in the list (for example under `src/vs/workbench/contrib`) before GitHub has streamed it; the row shows the busy marker, then the page jumps to it.
- Turbo navigation: from the Express compare, change the compare branch or tag with GitHub's own selector; the sidebar rebuilds for the new range with no duplicate sidebar. Press the browser Back button; still one sidebar.
- Open the Commits tab first, then Files changed: the tree is already built when the tab opens.
- `https://github.com/expressjs/express/compare` (bare page): nothing is injected and nothing is logged.
- Switch GitHub's theme between light and dark (Settings, Appearance): the sidebar follows without a reload.
- The private compare from the original screenshots, `volvo-cars/mfg-cws`, `master` against `feature/stamping-batch-production`: tree renders with the `eUtil` and other module folders and their rollups; the count matches the tab.
- Sign out of GitHub in a second profile and open a private compare: the sidebar shows the access error with a Retry button and the page is otherwise untouched.

- [ ] **Step 5: Fix what the checklist finds, then commit**

Any fix goes in the module that owns it: selectors and layout in `page.ts`, rendering in `render.ts`, flow in `controller.ts`. Add or adjust a unit test for each fix. Then:

```bash
pnpm test && pnpm typecheck && pnpm build
git add -A
git commit -m "feat: wire content script and verify on live compare pages"
```

---

### Task 10: Docs, store listing drafts, CI, and the store zip

**Files:**
- Create: `README.md`, `CHANGELOG.md`, `docs/store/listing.md`, `docs/store/privacy.md`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the finished extension.
- Produces: a repository ready to publish and a `.output/compare-tree-for-github-0.1.0-chrome.zip` ready for the Chrome Web Store dashboard.

- [ ] **Step 1: Write README.md**

````markdown
# Compare Tree for GitHub

A Chrome extension that adds a pull-request-style tree of changed folders and files to GitHub's
branch compare page (`github.com/<owner>/<repo>/compare/<base>...<head>`), with per-folder change
counts and click-to-jump to each diff. See what a branch touches without opening a pull request.

![Sidebar on a compare page](docs/store/screenshot-1.png)

## Features

- Folder tree of every changed file, one level per directory, like the PR "Files changed" sidebar.
- Per-file additions and deletions, status icons for added, modified, removed, and renamed files.
- Per-folder rollups: file count, additions, deletions.
- Click a file to jump to its diff, even before GitHub has streamed that part of the page.
- The file under the viewport top is highlighted as you scroll.
- Follows GitHub's light, dark, and dimmed themes.
- Works on private repositories through your existing GitHub session. No token, no setup.

## How it works

The extension downloads the compare's `.diff` from github.com (the same request your browser
would make if you opened the compare URL with `.diff` appended), parses it, and renders the tree
beside GitHub's diff list. It needs only the `storage` permission, to remember whether you hid the
sidebar. It makes no other network requests and collects no data.

## Install

From the Chrome Web Store: link to follow once the listing is live.

From source:

```bash
pnpm install
pnpm build
```

Then open `chrome://extensions`, enable Developer mode, choose "Load unpacked", and select
`.output/chrome-mv3`.

## Develop

```bash
pnpm dev        # watch mode, opens a Chrome profile with the extension installed
pnpm test       # unit tests
pnpm typecheck
pnpm zip        # store zip in .output/
```

## Limits

- Compare pages on github.com only. Commit pages, pull requests, and GitHub Enterprise Server
  hosts are not supported yet.
- The tree is rebuilt from GitHub's diff download; if GitHub ever truncates that download, the
  sidebar shows a warning with both counts.

## License

MIT
````

- [ ] **Step 2: Write CHANGELOG.md**

```markdown
# Changelog

## 0.1.0

First release.

- Folder tree with per-file and per-folder change counts on GitHub branch compare pages.
- Click-to-jump to each diff, active file highlighting, collapse and expand controls.
- Follows GitHub themes. Sidebar visibility is remembered.
```

- [ ] **Step 3: Write the store listing drafts**

`docs/store/listing.md`:

```markdown
# Chrome Web Store listing

## Name

Compare Tree for GitHub

## Short description (max 132 characters)

Adds a PR-style tree of changed folders and files to GitHub's branch compare page, with per-folder change counts.

## Detailed description

GitHub's branch compare page lists commits and diffs but gives no overview of which folders and
files changed. This extension adds the tree you know from pull requests: every changed file nested
by folder, with additions and deletions per file and per folder, status icons for added, removed,
and renamed files, and click-to-jump to any diff.

Use it to review what a branch touches before opening a pull request, or to inspect a range
between two tags or releases.

Works on private repositories through your existing GitHub session. No account, no token, no
configuration.

## Category

Developer Tools

## Single purpose

Show a navigable tree of the files changed on a GitHub branch compare page.

## Permission justification

- storage: remembers whether the user hid the sidebar.
- Content script on https://github.com/*/*/compare/*: needed to read the compare page and inject the tree.

## Data usage disclosure

The extension does not collect, store, or transmit any user data. It fetches the diff of the
compare page being viewed from github.com and keeps one boolean preference in local extension
storage.

## Assets to prepare

- Icon 128 px: generated in `.output/chrome-mv3/icons/128.png`.
- Screenshots 1280 by 800: `docs/store/screenshot-1.png` (Express compare, light theme) and
  `docs/store/screenshot-2.png` (Vite compare, dark theme).
```

`docs/store/privacy.md`:

```markdown
# Privacy policy for Compare Tree for GitHub

Compare Tree for GitHub does not collect, store, or share any personal data.

The extension runs only on GitHub branch compare pages (`https://github.com/*/*/compare/*`).
On such a page it downloads the diff of that compare from github.com, using the same browser
session GitHub already has, and renders a file tree from it. That download is the only network
request the extension makes. Nothing is sent anywhere else.

The extension stores a single preference in Chrome's local extension storage: whether you hid
the sidebar. It is never transmitted.

Questions: open an issue in the project repository.
```

- [ ] **Step 4: Write the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm zip
      - uses: actions/upload-artifact@v5
        with:
          name: extension-zip
          path: .output/*.zip
      - name: Attach zip to the release
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          files: .output/*.zip
```

The workflow cannot run until the repository exists on GitHub; the first push exercises it.

- [ ] **Step 5: Format, zip, verify, commit**

Run:

```bash
pnpm format && pnpm format:check && pnpm test && pnpm typecheck && pnpm zip && ls .output/*.zip
```

Expected: formatting applied and clean, tests and typecheck pass, and `.output/compare-tree-for-github-0.1.0-chrome.zip` exists. List it with `tar -tf .output/*.zip` and confirm it contains `manifest.json`, `content-scripts/compare.js`, `content-scripts/compare.css`, and `icons/`.

```bash
git add -A
git commit -m "docs: add README, changelog, store listing drafts, and CI workflow"
```

- [ ] **Step 6: Hand off the outward-facing steps to the user**

Do not do these without an explicit go-ahead; they are outward-facing:

1. Create the public GitHub repository and push `main` (for example `gh repo create compare-tree-for-github --public --source . --push`).
2. Take the two store screenshots at 1280 by 800 and save them under `docs/store/`.
3. Upload the zip in the Chrome Web Store developer dashboard using the texts in `docs/store/listing.md` and the privacy policy URL (the `privacy.md` file on GitHub works).

---

## Plan self-review

Spec coverage:

| Spec section | Task |
|---|---|
| 1 to 3, problem, goals, verified facts | Context for all tasks; facts encoded in page.ts constants (Tasks 4, 5), fixture DOM (Task 5), anchors (Task 4) |
| 4, architecture and module split | File structure; Tasks 1 to 9 create exactly those modules plus `controller.ts` for the lifecycle logic the spec assigns to the content script, keeping the entrypoint free of logic |
| 5, data model | Task 2 (`types.ts`) |
| 6, page adapter | Tasks 4 and 5 |
| 7, diff parser | Task 2 |
| 8, tree builder | Task 3 |
| 9, renderer and styles | Task 6 |
| 10, preferences | Task 7 |
| 11, lifecycle | Task 8 (controller) and Task 9 (WXT wiring, `wxt:locationchange`, `onInvalidated`) |
| 12, error handling | Task 8 error branches and tests, Task 9 checklist (signed-out case) |
| 13, performance | Streaming parse (Task 2, Task 8), single render with a fragment (Task 6), lazy anchors (Task 5), debounced observer (Task 5) |
| 14, testing | Every task; manual matrix in Task 9 |
| 15, packaging, store, repository | Task 1 (manifest, hygiene), Task 10 (docs, listing, CI, zip) |
| 16 and 17 | Out of scope by design |

Deliberate deviations from the spec, all small: the collator is pinned to `en` instead of the browser locale for deterministic ordering; the sticky-offset measurement is best-effort (any pinned `header` or `sticky` element); a `controller.ts` module holds the sync routine so it can be unit tested with fakes, and the content script stays a thin adapter.

Type consistency checked: `FileChange`, `DiffSummary`, `DirNode`, `SidebarState` are defined once in Task 2 and imported everywhere; `Sidebar` (Task 6) is the type consumed by `MountedSidebar` (Task 8) and the content script (Task 9); `Prefs` (Task 7) is consumed by `ControllerDeps` (Task 8); page adapter names (`waitFor`, `findDiffRoot`, `readTabFileCount`, `applyLayout`, `removeLayout`, `setStickyTop`, `measureStickyTop`, `removeStaleHosts`, `scrollToFile`, `observeActiveFile`, `HOST_TAG`, `OPEN_ATTR`, `SELECTORS`) match between Task 5 and Task 8.
