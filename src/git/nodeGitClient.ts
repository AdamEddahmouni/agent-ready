import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { ChangedFile, ChangedFileStatus, GitClient, GitDiffBase } from "./types.js";
import { GitClientError } from "./types.js";

const execFile = promisify(execFileCallback);

/** Caps subprocess output size read into memory (defense against pathological repositories). */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * Real GitClient backed by `node:child_process.execFile`. Never uses a
 * shell (`execFile`, not `exec`) and never interpolates a string into a
 * shell command line — every argument is a discrete argv element. The
 * only caller-influenced argument is an explicit `--against <ref>`, which
 * is passed after a `--end-of-options` marker so Git treats it strictly as
 * a revision, never as an option, even if it happens to start with `-`.
 */
export class NodeGitClient implements GitClient {
  async isRepository(root: string): Promise<boolean> {
    try {
      const { stdout } = await execFile("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: root,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      return stdout.trim() === "true";
    } catch (error) {
      if (isMissingGitError(error)) {
        throw new GitClientError("The `git` executable was not found on PATH.", { cause: error });
      }
      return false;
    }
  }

  async getChangedFiles(root: string, base: GitDiffBase): Promise<readonly ChangedFile[]> {
    if (base.kind === "ref") {
      return this.runNameStatus(root, [
        "diff",
        "--no-color",
        "--name-status",
        "--end-of-options",
        base.ref,
      ]);
    }

    if (base.kind === "staged") {
      // `git diff --cached` works even before the first commit (it then
      // compares the index against the empty tree), so no special-casing
      // is needed for a fresh, commit-less repository.
      return this.runNameStatus(root, ["diff", "--no-color", "--name-status", "--cached"]);
    }

    const hasHead = await this.hasHeadCommit(root);
    if (!hasHead) {
      // No commits yet: treat every currently staged/working/untracked file
      // as changed, per the project's confirmed default behavior.
      return this.listAllAsAdded(root);
    }

    const diffFiles = await this.runNameStatus(root, [
      "diff",
      "--no-color",
      "--name-status",
      "HEAD",
    ]);
    const untracked = await this.listUntracked(root);
    return [...diffFiles, ...untracked];
  }

  private async hasHeadCommit(root: string): Promise<boolean> {
    try {
      await execFile("git", ["rev-parse", "--verify", "-q", "HEAD"], {
        cwd: root,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      return true;
    } catch (error) {
      if (isMissingGitError(error)) {
        throw new GitClientError("The `git` executable was not found on PATH.", { cause: error });
      }
      return false;
    }
  }

  private async listUntracked(root: string): Promise<readonly ChangedFile[]> {
    const stdout = await this.run(root, ["status", "--porcelain", "--untracked-files=all"]);
    return parsePorcelainLines(stdout, (line) => line.startsWith("??"));
  }

  private async listAllAsAdded(root: string): Promise<readonly ChangedFile[]> {
    const stdout = await this.run(root, ["status", "--porcelain", "--untracked-files=all"]);
    return parsePorcelainLines(stdout, () => true);
  }

  private async runNameStatus(root: string, args: string[]): Promise<readonly ChangedFile[]> {
    const stdout = await this.run(root, args);
    return stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .map(parseNameStatusLine);
  }

  /** Runs a Git command whose failure always means "this operation could not complete". */
  private async run(root: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFile("git", args, {
        cwd: root,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      return stdout;
    } catch (error) {
      if (isMissingGitError(error)) {
        throw new GitClientError("The `git` executable was not found on PATH.", { cause: error });
      }
      const detail = extractStderr(error);
      throw new GitClientError(detail ?? `git ${args.join(" ")} failed.`, { cause: error });
    }
  }
}

function parsePorcelainLines(
  stdout: string,
  include: (line: string) => boolean,
): readonly ChangedFile[] {
  return stdout
    .split("\n")
    .filter((line) => line.length > 0 && include(line))
    .map((line) => ({ path: line.slice(3), status: "added" as const }));
}

function parseNameStatusLine(line: string): ChangedFile {
  const [statusCode, ...pathParts] = line.split("\t");
  if (statusCode?.startsWith("R") === true) {
    const [previousPath, path] = pathParts;
    return { path: path ?? previousPath ?? "", previousPath, status: "renamed" };
  }
  return { path: pathParts[0] ?? "", status: statusFromCode(statusCode) };
}

function statusFromCode(code: string | undefined): ChangedFileStatus {
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  return "modified";
}

function isMissingGitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function extractStderr(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.trim().length > 0) {
      return stderr.trim();
    }
  }
  return undefined;
}
