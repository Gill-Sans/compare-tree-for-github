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
