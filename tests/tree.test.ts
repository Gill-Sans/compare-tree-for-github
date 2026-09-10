import { describe, expect, it } from 'vitest';
import { buildTree, compactTree } from '../src/lib/tree';
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

describe('compactTree', () => {
  /** Folders as { "name/": children }, files as their name. */
  const shape = (node: DirNode): unknown[] =>
    node.children.map((c) => (c.kind === 'dir' ? { [`${c.name}/`]: shape(c) } : c.name));

  it('folds single-folder chains the way GitHub pull requests do', () => {
    const service = 'eQualityControl/batch-ftt-service/src';
    const pkg = 'java/com/volvocars/vcc/cws/e_qualitycontrol/batchfttservice';
    const tree = compactTree(
      buildTree([
        change('api-client/api-docs/batch-ftt-api-docs.yaml'),
        change(`${service}/main/${pkg}/domain/BatchFttCalculator.java`),
        change(`${service}/main/${pkg}/dto/BatchFttTimeFrameResultDto.java`),
        change(`${service}/test/${pkg}/BatchFttTimeFrameResultDtoTestMother.java`),
        change(`${service}/test/resources/json/response/results-calculation.json`),
      ]),
    );
    expect(shape(tree)).toEqual([
      { 'api-client/api-docs/': ['batch-ftt-api-docs.yaml'] },
      {
        [`${service}/`]: [
          {
            [`main/${pkg}/`]: [
              { 'domain/': ['BatchFttCalculator.java'] },
              { 'dto/': ['BatchFttTimeFrameResultDto.java'] },
            ],
          },
          {
            'test/': [
              { [`${pkg}/`]: ['BatchFttTimeFrameResultDtoTestMother.java'] },
              { 'resources/json/response/': ['results-calculation.json'] },
            ],
          },
        ],
      },
    ]);
  });

  it('keeps the deepest path and the rollups on a folded folder', () => {
    const tree = compactTree(buildTree([change('a/b/c/x.ts', 2, 1), change('a/b/c/y.ts', 3, 0)]));
    expect(tree).toMatchObject({ name: '', path: '', files: 2, additions: 5, deletions: 1 });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]).toMatchObject({
      kind: 'dir',
      name: 'a/b/c',
      path: 'a/b/c',
      files: 2,
      additions: 5,
      deletions: 1,
    });
  });

  it('never folds a file into its folder and stops where a folder branches', () => {
    const tree = compactTree(
      buildTree([
        change('docs/readme.md'),
        change('src/a.ts'),
        change('src/lib/b.ts'),
        change('top.txt'),
      ]),
    );
    expect(shape(tree)).toEqual([
      { 'docs/': ['readme.md'] },
      { 'src/': [{ 'lib/': ['b.ts'] }, 'a.ts'] },
      'top.txt',
    ]);
  });

  it('leaves the input tree untouched', () => {
    const built = buildTree([change('a/b/c.ts'), change('a/d/e/f.ts')]);
    const before = structuredClone(built);
    compactTree(built);
    expect(built).toEqual(before);
  });
});
