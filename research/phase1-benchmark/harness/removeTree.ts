import { rm } from "node:fs/promises";

/**
 * Removes a prepared workspace, fixture checkout or capture directory.
 *
 * Windows reports `EBUSY` or `EPERM` when a tree is removed while a `git` child
 * process or a file scanner still holds a handle inside it. That window is
 * transient, and Node retries exactly those codes for a recursive removal, so
 * give it enough attempts to outlast the handle instead of turning a finished
 * test into a failure. `force` keeps a missing tree from being an error.
 */
export async function removeTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
