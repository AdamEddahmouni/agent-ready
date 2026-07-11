import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/**
 * Creates an isolated, real temporary directory for integration tests
 * that exercise actual file-system I/O (as opposed to unit tests, which
 * use InMemoryFileSystem). Callers must call cleanup() when done.
 */
export async function createTestRepo(
  files: Readonly<Record<string, string>>,
): Promise<{ readonly root: string; readonly cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "agent-ready-test-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return {
    root,
    // Windows can keep a just-terminated process's working directory busy
    // briefly after the process tree has closed. fs.rm's bounded retry support
    // handles that normal release race without hiding a persistent cleanup
    // failure: EBUSY/EPERM/ENOTEMPTY are retried with linear backoff, then the
    // original error is still surfaced.
    cleanup: () =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }),
  };
}

/**
 * Runs `git init` plus a local, repo-scoped user.email/user.name (CI
 * sandboxes often have no global Git identity configured, which would
 * otherwise make `git commit` fail).
 */
export async function initGitRepo(root: string): Promise<void> {
  await execFile("git", ["init"], { cwd: root });
  await execFile("git", ["config", "user.email", "agent-ready-test@example.com"], { cwd: root });
  await execFile("git", ["config", "user.name", "Agent Ready Test"], { cwd: root });
}

/** Stages every change in the working tree and commits it. */
export async function gitCommitAll(root: string, message: string): Promise<void> {
  await execFile("git", ["add", "-A"], { cwd: root });
  await execFile("git", ["commit", "-m", message], { cwd: root });
}

/**
 * Creates a real temporary Git repository (init + identity + an initial
 * commit of `files`) for integration tests that exercise `agent-ready
 * check` against real `git` subprocess output.
 */
export async function createTestGitRepo(
  files: Readonly<Record<string, string>>,
): Promise<{ readonly root: string; readonly cleanup: () => Promise<void> }> {
  const repo = await createTestRepo(files);
  await initGitRepo(repo.root);
  await gitCommitAll(repo.root, "Initial commit");
  return repo;
}
