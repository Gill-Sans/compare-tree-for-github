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
