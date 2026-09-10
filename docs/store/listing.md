# Chrome Web Store listing

## Name

Compare Tree for GitHub

## Short description (max 132 characters)

Adds a PR-style tree of changed folders and files to GitHub's branch compare page, with per-folder change counts.

## Detailed description

GitHub's branch compare page lists commits and diffs but gives no overview of which folders and
files changed. This extension adds the tree you know from pull requests: every changed file nested
by folder, with additions and deletions per file and per folder, status icons for added, removed,
and renamed files, and click-to-jump to any diff. Folders that only hold one sub-folder fold into
a single row, and you can drag the divider to give long paths more room.

Use it to review what a branch touches before opening a pull request, or to inspect a range
between two tags or releases.

Works on private repositories through your existing GitHub session. No account, no token, no
configuration.

## Category

Developer Tools

## Single purpose

Show a navigable tree of the files changed on a GitHub branch compare page.

## Permission justification

- storage: remembers whether the user hid the sidebar and the width they dragged it to.
- Content script on https://github.com/*: GitHub switches pages without a full reload and Chrome injects content scripts only on page loads, so the script runs on github.com to notice navigation to a branch compare page. It stays idle elsewhere; on a compare page it reads that page and downloads its .diff to build the tree.

## Data usage disclosure

The extension does not collect, store, or transmit any user data. It fetches the diff of the
compare page being viewed from github.com and keeps two preferences (sidebar visibility and width) in
local extension storage.

## Assets to prepare

- Icon 128 px: generated in `.output/chrome-mv3/icons/128.png`.
- Screenshots 1280 by 800: `docs/store/screenshot-1.png` (Vite compare, light theme) and
  `docs/store/screenshot-2.png` (Vite compare, dark theme).
