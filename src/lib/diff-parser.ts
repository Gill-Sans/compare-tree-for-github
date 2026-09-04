import type { DiffSummary, FileChange } from './types';

export interface DiffParser {
  /** Feed the next chunk of diff text. Chunks may split lines anywhere. */
  push(chunk: string): void;
  /** Flush the last partial line and return the final summary. Idempotent. */
  end(): DiffSummary;
  /** Snapshot of everything parsed so far, including the file in progress. */
  current(): DiffSummary;
}

type Section = 'header' | 'hunk' | 'binary';

const DIFF_HEADER = 'diff --git ';

export function createDiffParser(): DiffParser {
  const files: FileChange[] = [];
  let pending = '';
  let file: FileChange | null = null;
  let section: Section = 'header';
  /** True once rename/copy lines supplied the paths; `---`/`+++` lines are then ignored. */
  let pathsAuthoritative = false;
  /** Path seen on the `--- a/...` line, used to name deleted files. */
  let minusPath: string | null = null;

  function finishFile(): void {
    if (file) files.push(file);
    file = null;
  }

  function startFile(rest: string): void {
    finishFile();
    const split = splitHeaderPaths(rest);
    file = {
      path: split ? split.b : rest,
      status: 'modified',
      additions: 0,
      deletions: 0,
      binary: false,
    };
    section = 'header';
    pathsAuthoritative = false;
    minusPath = null;
  }

  function handleLine(line: string): void {
    if (line.startsWith(DIFF_HEADER)) {
      startFile(line.slice(DIFF_HEADER.length));
      return;
    }
    if (!file) return;

    if (section === 'hunk') {
      // Inside hunks every line is content. A removed line whose text starts with "-- "
      // shows up as "--- ..." and must count as a deletion, never as a header.
      if (line.startsWith('+')) file.additions += 1;
      else if (line.startsWith('-')) file.deletions += 1;
      return;
    }
    if (section === 'binary') return;

    if (line.startsWith('@@')) {
      section = 'hunk';
      return;
    }
    if (line.startsWith('new file mode')) {
      file.status = 'added';
      return;
    }
    if (line.startsWith('deleted file mode')) {
      file.status = 'removed';
      return;
    }
    if (line.startsWith('rename from ')) {
      file.oldPath = unquotePath(line.slice('rename from '.length));
      file.status = 'renamed';
      pathsAuthoritative = true;
      return;
    }
    if (line.startsWith('rename to ')) {
      file.path = unquotePath(line.slice('rename to '.length));
      file.status = 'renamed';
      pathsAuthoritative = true;
      return;
    }
    if (line.startsWith('copy from ')) {
      file.oldPath = unquotePath(line.slice('copy from '.length));
      file.status = 'copied';
      pathsAuthoritative = true;
      return;
    }
    if (line.startsWith('copy to ')) {
      file.path = unquotePath(line.slice('copy to '.length));
      file.status = 'copied';
      pathsAuthoritative = true;
      return;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.binary = true;
      section = 'binary';
      return;
    }
    if (line.startsWith('--- ')) {
      const target = line.slice(4);
      if (target === '/dev/null') {
        if (file.status === 'modified') file.status = 'added';
      } else if (!pathsAuthoritative) {
        minusPath = stripPrefix(unquotePath(target), 'a/');
      }
      return;
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      if (target === '/dev/null') {
        file.status = 'removed';
        if (!pathsAuthoritative && minusPath !== null) file.path = minusPath;
      } else if (!pathsAuthoritative) {
        file.path = stripPrefix(unquotePath(target), 'b/');
      }
      return;
    }
    // index, old mode, new mode, similarity index, dissimilarity index: nothing to record.
  }

  function summary(includeCurrent: boolean): DiffSummary {
    const list = includeCurrent && file ? [...files, { ...file }] : [...files];
    let additions = 0;
    let deletions = 0;
    for (const f of list) {
      additions += f.additions;
      deletions += f.deletions;
    }
    return { files: list, additions, deletions };
  }

  return {
    push(chunk) {
      const data = pending + chunk;
      let start = 0;
      for (let nl = data.indexOf('\n'); nl !== -1; nl = data.indexOf('\n', start)) {
        handleLine(stripCr(data.slice(start, nl)));
        start = nl + 1;
      }
      pending = data.slice(start);
    },
    end() {
      if (pending.length > 0) {
        handleLine(stripCr(pending));
        pending = '';
      }
      finishFile();
      return summary(false);
    },
    current() {
      return summary(true);
    },
  };
}

function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function stripPrefix(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

/** Unquote a single path token. Unquoted tokens lose any trailing tab-separated metadata. */
function unquotePath(raw: string): string {
  if (raw.startsWith('"')) {
    const quoted = readQuoted(raw, 0);
    return quoted ? quoted.value : raw;
  }
  const tab = raw.indexOf('\t');
  return tab === -1 ? raw : raw.slice(0, tab);
}

const ESCAPES: Record<string, number> = {
  n: 10,
  t: 9,
  r: 13,
  a: 7,
  b: 8,
  f: 12,
  v: 11,
  '"': 34,
  '\\': 92,
};

/**
 * Parse a C-style quoted string starting at `s[start] === '"'`, as git emits for paths with
 * unusual characters. Octal escapes are raw UTF-8 bytes. Returns the decoded value and the
 * index just past the closing quote, or null when the token is not a complete quoted string.
 */
export function readQuoted(s: string, start: number): { value: string; end: number } | null {
  if (s[start] !== '"') return null;
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer) {
      bytes.push(...encoder.encode(buffer));
      buffer = '';
    }
  };
  let i = start + 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      flush();
      return { value: new TextDecoder().decode(new Uint8Array(bytes)), end: i + 1 };
    }
    if (ch !== '\\') {
      buffer += ch;
      i += 1;
      continue;
    }
    const next = s[i + 1];
    if (next === undefined) return null;
    if (next >= '0' && next <= '7') {
      flush();
      let j = i + 1;
      let octal = '';
      // charAt keeps these relational compares typed as string under noUncheckedIndexedAccess.
      while (j < s.length && octal.length < 3 && s.charAt(j) >= '0' && s.charAt(j) <= '7') {
        octal += s.charAt(j);
        j += 1;
      }
      bytes.push(parseInt(octal, 8));
      i = j;
      continue;
    }
    const code = ESCAPES[next];
    if (code === undefined) return null;
    flush();
    bytes.push(code);
    i += 2;
  }
  return null;
}

/**
 * Split the text after `diff --git ` into old and new paths with the `a/` and `b/` prefixes
 * removed. Unquoted paths may contain spaces, so the symmetric case `a/X b/X` is detected by
 * length; asymmetric unquoted pairs split at the last ` b/`.
 */
export function splitHeaderPaths(rest: string): { a: string; b: string } | null {
  let a: string;
  let tail: string;
  if (rest.startsWith('"')) {
    const quoted = readQuoted(rest, 0);
    if (!quoted) return null;
    a = quoted.value;
    tail = rest.slice(quoted.end).trimStart();
  } else {
    const n = rest.length;
    if (n % 2 === 1) {
      const len = (n - 5) / 2;
      if (
        len > 0 &&
        rest.startsWith('a/') &&
        rest.slice(2 + len, n - len) === ' b/' &&
        rest.slice(2, 2 + len) === rest.slice(n - len)
      ) {
        const path = rest.slice(2, 2 + len);
        return { a: path, b: path };
      }
    }
    const quotedB = rest.indexOf(' "b/');
    const cut = quotedB !== -1 ? quotedB : rest.lastIndexOf(' b/');
    if (cut <= 0) return null;
    a = rest.slice(0, cut);
    tail = rest.slice(cut + 1);
  }
  let b: string;
  if (tail.startsWith('"')) {
    const quoted = readQuoted(tail, 0);
    if (!quoted) return null;
    b = quoted.value;
  } else {
    b = tail;
  }
  return { a: stripPrefix(a, 'a/'), b: stripPrefix(b, 'b/') };
}
