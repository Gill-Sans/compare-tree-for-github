# Privacy policy for Compare Tree for GitHub

Compare Tree for GitHub does not collect, store, or share any personal data.

The extension runs only on GitHub branch compare pages (`https://github.com/*/*/compare/*`).
On such a page it downloads the diff of that compare from github.com, using the same browser
session GitHub already has, and renders a file tree from it. That download is the only network
request the extension makes. Nothing is sent anywhere else.

The extension stores a single preference in Chrome's local extension storage: whether you hid
the sidebar. It is never transmitted.

Questions: open an issue in the project repository.
