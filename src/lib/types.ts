export type FileStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'copied';

export interface FileChange {
  /** New path for renames and copies. */
  path: string;
  /** Previous path, present for renamed and copied files. */
  oldPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface DiffSummary {
  files: FileChange[];
  additions: number;
  deletions: number;
}

export interface DirNode {
  kind: 'dir';
  /** '' for the root. */
  name: string;
  /** '' for the root, otherwise 'a/b/c' without a trailing slash. */
  path: string;
  children: TreeNode[];
  /** Rollups over the whole subtree. */
  files: number;
  additions: number;
  deletions: number;
}

export interface FileNode {
  kind: 'file';
  name: string;
  path: string;
  change: FileChange;
}

export type TreeNode = DirNode | FileNode;

export type SidebarState =
  | { kind: 'loading'; expectedFiles: number | null; bytes: number }
  | { kind: 'ready'; warning?: string }
  | { kind: 'error'; message: string };
