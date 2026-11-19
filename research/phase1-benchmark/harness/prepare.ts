import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { runTwinBuild } from "../../../src/cli/commands/twinBuild.js";
import { NodeFileSystem } from "../../../src/filesystem/nodeFileSystem.js";
import { removeTree } from "../../../src/filesystem/removeTree.js";
import type { Condition, RepositoryPin } from "./types.js";

const execFile = promisify(execFileCallback);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface CheckoutRequest {
  readonly url: string;
  readonly commit: string;
  readonly destination: string;
}

export interface RepositoryFetcher {
  checkout(request: CheckoutRequest): Promise<void>;
}

export interface PreparedWorkspace {
  readonly repositoryId: string;
  readonly commit: string;
  readonly runRoot: string;
  /** Isolated checkout for this trial. */
  readonly path: string;
}

export interface PreparedConditionWorkspace extends PreparedWorkspace {
  /** Present only for the agent-ready condition. */
  readonly snapshotPath?: string;
}

export interface SnapshotBuilder {
  build(workspace: PreparedWorkspace): Promise<string>;
}

export interface PrepareWorkspaceOptions {
  readonly repository: RepositoryPin;
  readonly condition: Condition;
  readonly baseDirectory?: string;
  readonly fetcher?: RepositoryFetcher;
  readonly snapshotBuilder?: SnapshotBuilder;
}

async function git(args: readonly string[], cwd?: string): Promise<string> {
  const options = {
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    ...(cwd !== undefined && { cwd }),
  };
  const { stdout } = await execFile("git", [...args], options);
  return stdout.trim();
}

/**
 * Real fetcher for a full 40-character pin. It initializes a fresh repository,
 * fetches exactly the pinned commit, checks it out detached, and verifies the
 * resulting HEAD before the trial is allowed to start. No shell is involved.
 */
export class GitRepositoryFetcher implements RepositoryFetcher {
  async checkout(request: CheckoutRequest): Promise<void> {
    if (!/^[0-9a-f]{40}$/.test(request.commit)) {
      throw new Error(`refusing to fetch non-canonical commit ${JSON.stringify(request.commit)}`);
    }
    if (!request.url.startsWith("https://")) {
      throw new Error(`refusing to fetch non-HTTPS repository URL ${JSON.stringify(request.url)}`);
    }

    await mkdir(dirname(request.destination), { recursive: true });
    await git(["init", "--quiet", request.destination]);
    await git(["remote", "add", "origin", request.url], request.destination);
    await git(["fetch", "--quiet", "--depth=1", "origin", request.commit], request.destination);
    await git(["checkout", "--quiet", "--detach", "FETCH_HEAD"], request.destination);
    const head = await git(["rev-parse", "HEAD"], request.destination);
    if (head !== request.commit) {
      throw new Error(
        `checked out ${head}, expected pinned commit ${request.commit}; refusing to run`,
      );
    }
  }
}

/**
 * Builds the agent-ready snapshot outside the checkout so it cannot appear in
 * the agent's file diff. The snapshot is produced from the pristine pinned
 * tree before the trial starts.
 */
export class TwinSnapshotBuilder implements SnapshotBuilder {
  async build(workspace: PreparedWorkspace): Promise<string> {
    const snapshotPath = join(workspace.runRoot, "snapshot.json");
    const outcome = await runTwinBuild(new NodeFileSystem(), {
      root: workspace.path,
      output: snapshotPath,
      force: true,
    });
    if (outcome.exitCode !== 0 || outcome.stderr.length > 0) {
      throw new Error(
        `twin build failed for ${workspace.repositoryId}: ${outcome.stderr.trim() || outcome.stdout.trim()}`,
      );
    }
    return snapshotPath;
  }
}

/** Creates a unique run root and a fresh checkout inside it. */
export async function prepareWorkspace(options: {
  readonly repository: RepositoryPin;
  readonly baseDirectory?: string;
  readonly fetcher?: RepositoryFetcher;
}): Promise<PreparedWorkspace> {
  const baseDirectory = options.baseDirectory ?? tmpdir();
  await mkdir(baseDirectory, { recursive: true });
  const runRoot = await mkdtemp(join(baseDirectory, "agent-ready-phase1-"));
  const destination = join(runRoot, "repo");
  const fetcher = options.fetcher ?? new GitRepositoryFetcher();

  try {
    await fetcher.checkout({
      url: options.repository.url,
      commit: options.repository.commit,
      destination,
    });
  } catch (error) {
    await removeTree(runRoot);
    throw error;
  }

  return {
    repositoryId: options.repository.id,
    commit: options.repository.commit,
    runRoot,
    path: destination,
  };
}

/**
 * Prepares the condition-specific environment. Only the agent-ready condition
 * receives a snapshot path; the raw condition gets the checkout alone.
 */
export async function prepareConditionWorkspace(
  options: PrepareWorkspaceOptions,
): Promise<PreparedConditionWorkspace> {
  const workspace = await prepareWorkspace({
    repository: options.repository,
    ...(options.baseDirectory !== undefined && { baseDirectory: options.baseDirectory }),
    ...(options.fetcher !== undefined && { fetcher: options.fetcher }),
  });

  if (options.condition === "raw") return workspace;

  try {
    const snapshotPath = await (options.snapshotBuilder ?? new TwinSnapshotBuilder()).build(
      workspace,
    );
    return { ...workspace, snapshotPath };
  } catch (error) {
    await removePreparedWorkspace(workspace);
    throw error;
  }
}

export async function removePreparedWorkspace(
  workspace: Pick<PreparedWorkspace, "runRoot">,
): Promise<void> {
  await removeTree(workspace.runRoot);
}
