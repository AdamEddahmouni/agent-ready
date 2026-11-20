import { rm } from "node:fs/promises";

/**
 * Removes a temporary directory tree.
 *
 * Windows can hold a handle inside a tree for a moment after the process that
 * used it exits (a `git` child, an editor or a scanner), and rejects the
 * delete with `EBUSY` or `EPERM` until it lets go. `fs.rm` retries exactly
 * those codes beside `ENFILE`, `EMFILE` and `ENOTEMPTY` with a linear backoff,
 * so this uses the same budget as `tests/integration/testRepo.ts`: six
 * attempts at 100 ms each is about a second of grace, far more than a handle
 * release needs and well inside a test's own timeout. A persistent failure is
 * still surfaced rather than hidden.
 */
export async function removeTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
