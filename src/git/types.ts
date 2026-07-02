/**
 * Narrow Git-reading boundary, mirroring `filesystem/types.ts`'s pattern:
 * domain/CLI code depends on this interface, not on `node:child_process`
 * directly, so `agent-ready check` can be tested against a fake without
 * invoking a real `git` process. See ADR-0013 for why this is the first
 * process-spawning code path in the project and how it stays within the
 * "never execute contract-declared commands" boundary (ADR-0006): every
 * argument passed to `git` here is Agent-Ready-hardcoded or a validated,
 * discrete CLI argument, never contract content.
 */

export type ChangedFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface ChangedFile {
  readonly path: string;
  readonly status: ChangedFileStatus;
  /** Present only when `status` is `"renamed"`: the file's path before the rename. */
  readonly previousPath?: string;
}

export type GitDiffBase =
  | { readonly kind: "working-tree" }
  | { readonly kind: "staged" }
  | { readonly kind: "ref"; readonly ref: string };

export interface GitClient {
  /** Whether `root` is inside a Git working tree. */
  isRepository(root: string): Promise<boolean>;
  /** Lists files changed relative to `base`, rooted at `root`. */
  getChangedFiles(root: string, base: GitDiffBase): Promise<readonly ChangedFile[]>;
}

export class GitClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GitClientError";
  }
}
