/**
 * `scripts/check-commit-signing.mjs` is what blocks a pull request whose
 * commits cannot merge into `main` (required_signatures). Its two load-bearing
 * answers are "an unsigned range fails" and "a signed range passes"; both are
 * pinned here against real Git objects rather than mocks.
 *
 * A real signing key is not required: a commit is signed when its object
 * carries a `gpgsig` header, so the test writes that object directly. This is
 * also why the script checks for the header instead of `%G?`: git cannot verify
 * an SSH signature without an `allowedSignersFile`, and validity is GitHub's
 * job, not the preflight's.
 */

import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const script = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../scripts/check-commit-signing.mjs",
);

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd: root });
  return stdout.trim();
}

async function runCheck(root: string, args: readonly string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFile(process.execPath, [script, ...args], {
      cwd: root,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    if (typeof failure.code !== "number") {
      throw error;
    }
    return { code: failure.code, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

/**
 * Writes a commit object with a `gpgsig` header and points `refs/heads/signed`
 * at it. The signature bytes are not valid, which is deliberate: the preflight
 * proves presence, and GitHub is what proves the signature belongs to the
 * committing account.
 */
async function createSignedCommit(root: string, parent: string, message: string): Promise<string> {
  const tree = await git(root, ["rev-parse", `${parent}^{tree}`]);
  const identity = "Agent Ready Test <agent-ready-test@example.com> 1700000000 +0000";
  const object = [
    `tree ${tree}`,
    `parent ${parent}`,
    `author ${identity}`,
    `committer ${identity}`,
    "gpgsig -----BEGIN SSH SIGNATURE-----",
    " ZmFrZQ==",
    " -----END SSH SIGNATURE-----",
    "",
    message,
    "",
  ].join("\n");
  const objectPath = join(root, "signed-commit-object");
  await writeFile(objectPath, object, "utf8");
  const sha = await git(root, ["hash-object", "-t", "commit", "-w", objectPath]);
  await git(root, ["update-ref", "refs/heads/signed", sha]);
  return sha;
}

describe("commit signing preflight", () => {
  let repo: string;
  let initial: string;
  let unsigned: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "agent-ready-signing-"));
    await git(repo, ["init", "--quiet"]);
    await git(repo, ["config", "user.email", "agent-ready-test@example.com"]);
    await git(repo, ["config", "user.name", "Agent Ready Test"]);
    await git(repo, ["config", "commit.gpgsign", "false"]);
    await writeFile(join(repo, "file.txt"), "one\n", "utf8");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "--quiet", "-m", "Initial commit"]);
    initial = await git(repo, ["rev-parse", "HEAD"]);
    await writeFile(join(repo, "file.txt"), "two\n", "utf8");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "--quiet", "-m", "Unsigned change"]);
    unsigned = await git(repo, ["rev-parse", "HEAD"]);
    // Leave no `main` ref behind, so the default range is the tip and not
    // `main..HEAD`, whatever branch name this git's init.defaultBranch uses.
    await git(repo, ["branch", "--move", "work"]);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("fails an unsigned range and names every unsigned commit", async () => {
    const result = await runCheck(repo, ["--range", `${initial}..${unsigned}`]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "main requires every commit to carry a verified signature (required_signatures).",
    );
    expect(result.stderr).toContain("1 of 1 commit(s)");
    expect(result.stderr).toContain(unsigned.slice(0, 12));
    expect(result.stderr).toContain("Unsigned change");
  });

  it("passes a range whose commits all carry a signature", async () => {
    const signed = await createSignedCommit(repo, unsigned, "Signed change");

    const result = await runCheck(repo, ["--range", `${unsigned}..${signed}`]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("All 1 commit(s)");
    expect(result.stdout).toContain("carry a signature");
  });

  it("counts only the unsigned commits in a mixed range", async () => {
    const signed = await createSignedCommit(repo, unsigned, "Signed change");

    const result = await runCheck(repo, ["--base", initial, "--head", signed]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("1 of 2 commit(s)");
    expect(result.stderr).toContain("Unsigned change");
    expect(result.stderr).not.toContain("Signed change");
  });

  it("accepts an empty range", async () => {
    const result = await runCheck(repo, ["--range", `${unsigned}..${unsigned}`]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No commits to check");
  });

  it("checks the tip when no base branch exists", async () => {
    const signed = await createSignedCommit(repo, unsigned, "Signed change");
    await git(repo, ["reset", "--hard", signed]);

    const result = await runCheck(repo, []);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("All 1 commit(s)");
  });

  it("rejects a missing option value with the usage error", async () => {
    const result = await runCheck(repo, ["--range"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--range requires a value");
    expect(result.stderr).toContain("Usage:");
  });

  it("rejects an unknown option with the usage error", async () => {
    const result = await runCheck(repo, ["--bogus"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unknown option: --bogus");
    expect(result.stderr).toContain("Usage:");
  });
});
