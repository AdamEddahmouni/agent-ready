import type { ChangedFile, GitClient, GitDiffBase } from "./types.js";

export interface FakeGitClientOptions {
  readonly isRepo: boolean;
  readonly changedFiles?: readonly ChangedFile[];
  /** If set, getChangedFiles throws this error instead of returning a result. */
  readonly throwOnDiff?: Error;
}

/**
 * Deterministic test double for GitClient, in the same spirit as
 * InMemoryFileSystem: no real `git` process is ever invoked.
 */
export class FakeGitClient implements GitClient {
  constructor(private readonly options: FakeGitClientOptions) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  async isRepository(): Promise<boolean> {
    return this.options.isRepo;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  async getChangedFiles(_root: string, _base: GitDiffBase): Promise<readonly ChangedFile[]> {
    if (this.options.throwOnDiff !== undefined) {
      throw this.options.throwOnDiff;
    }
    return this.options.changedFiles ?? [];
  }
}
