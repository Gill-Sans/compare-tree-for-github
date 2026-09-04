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
