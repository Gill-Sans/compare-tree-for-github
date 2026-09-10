# Changelog

## 1.1.0

- Folders that only hold one sub-folder fold into a single row, like `src/main/java/com/acme`,
  as in GitHub's pull request tree.
- GitHub-style tree: 32px rows, blue folder icons, a file icon per change status, guide lines, and
  an accent bar on the file in view.
- Drag the divider between the tree and the diff to resize the tree, or use the arrow keys on it.
  Double-click resets the width. The width is remembered.
- The tree now appears when a compare is opened from the branch picker or another GitHub page
  without a page reload.
- Opening and closing folders is several times faster on compares with thousands of files, and
  resizing no longer restyles GitHub's diff.

## 1.0.0

First release.

- Folder tree with per-file and per-folder change counts on GitHub branch compare pages.
- Click-to-jump to each diff, active file highlighting, collapse and expand controls.
- Follows GitHub themes. Sidebar visibility is remembered.
