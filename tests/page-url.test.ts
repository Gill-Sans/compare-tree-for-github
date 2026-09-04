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
    expect(
      parseCompareUrl('https://github.com/expressjs/express/compare/4.18.2...4.19.2')?.range,
    ).toBe('4.18.2...4.19.2');
    expect(parseCompareUrl('https://github.com/o/r/compare/a..b')?.range).toBe('a..b');
  });

  it('keeps fork prefixes and encoded characters untouched', () => {
    expect(
      parseCompareUrl('https://github.com/o/r/compare/main...someone:fork:feature%2Fx')?.range,
    ).toBe('main...someone:fork:feature%2Fx');
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
