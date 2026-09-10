# Privacy policy for Compare Tree for GitHub

Compare Tree for GitHub does not collect, store, or share any personal data.

The extension's script loads on github.com pages, because GitHub switches pages without a full
reload and the script has to be present to notice when you open a branch compare page
(`https://github.com/<owner>/<repo>/compare/<base>...<head>`). It reads nothing and does nothing
on any other page. On a compare page it downloads the diff of that compare from github.com, using
the same browser session GitHub already has, and renders a file tree from it. That download is the only network
request the extension makes. Nothing is sent anywhere else.

The extension stores a single preference in Chrome's local extension storage: whether you hid
the sidebar. It is never transmitted.

Questions: open an issue in the project repository.
