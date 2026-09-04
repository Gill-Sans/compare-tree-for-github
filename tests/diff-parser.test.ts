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
    expect(byPath(summary, 'README.md')).toMatchObject({
      status: 'added',
      additions: 2,
      deletions: 0,
    });
    expect(byPath(summary, 'old.txt')).toMatchObject({
      status: 'removed',
      additions: 0,
      deletions: 2,
    });
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
    expect(byPath(summary, 'img/logo.png')).toMatchObject({
      status: 'added',
      binary: true,
      additions: 0,
    });
    expect(byPath(summary, 'img/icon.png')).toMatchObject({
      status: 'modified',
      binary: true,
      additions: 0,
      deletions: 0,
    });
  });

  it('reports mode-only changes and empty files with zero counts', () => {
    expect(byPath(summary, 'bin/run.sh')).toMatchObject({
      status: 'modified',
      additions: 0,
      deletions: 0,
    });
    expect(byPath(summary, 'empty.txt')).toMatchObject({
      status: 'added',
      additions: 0,
      deletions: 0,
    });
  });

  it('counts submodule pointer changes as one and one', () => {
    expect(byPath(summary, 'vendor/lib')).toMatchObject({ additions: 1, deletions: 1 });
  });

  it('decodes quoted paths with octal UTF-8 escapes', () => {
    expect(byPath(summary, 'sp ace/café.txt')).toMatchObject({ additions: 1, deletions: 0 });
  });

  it('records copies', () => {
    expect(byPath(summary, 'copy-dst.txt')).toMatchObject({
      status: 'copied',
      oldPath: 'copy-src.txt',
    });
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
    expect(splitHeaderPaths('a/old.txt b/new name.txt')).toEqual({
      a: 'old.txt',
      b: 'new name.txt',
    });
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
