import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

/**
 * The agent-ready CLI is the artifact under test, so a trial must query through
 * a build of the commit the run manifest pins — not whichever `dist/` happens
 * to be on the machine. A build writes `.agent-ready-build.json` next to the
 * package, and every run refuses a CLI whose stamp is missing, dirty, or from
 * another commit.
 */

const execFileAsync = promisify(execFile);
const PACKAGE_NAME = "@adameddahmouni/agent-ready";

export const BUILD_INFO_FILE = ".agent-ready-build.json";
export const BUILD_DIRECTORY = "build";

export interface BuildInfo {
  readonly commit: string;
  readonly dirty: boolean;
  readonly version?: string;
  readonly builtAt?: string;
}

export interface VerifiedCli {
  readonly cliPath: string;
  readonly packageRoot: string;
  readonly buildInfo: BuildInfo;
}

export class AgentReadyCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentReadyCliError";
  }
}

/** `<package>/dist/cli/index.js` -> `<package>`. */
export function packageRootOf(cliPath: string): string {
  return dirname(dirname(dirname(cliPath)));
}

export async function readBuildInfo(packageRoot: string): Promise<BuildInfo | undefined> {
  const path = join(packageRoot, BUILD_INFO_FILE);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(await readFile(path, "utf8")) as BuildInfo;
  } catch {
    return undefined;
  }
}

async function packageNameOf(packageRoot: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
      readonly name?: unknown;
    };
    return typeof parsed.name === "string" ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Refuses a CLI that cannot be tied to the pinned commit. The message names the
 * remedy rather than leaving the operator to guess why `dist/` was rejected.
 */
export async function verifyAgentReadyCli(options: {
  readonly cliPath: string;
  readonly pinnedCommit: string;
}): Promise<VerifiedCli> {
  if (!existsSync(options.cliPath)) {
    throw new AgentReadyCliError(
      `no CLI at ${options.cliPath}; build the pinned commit with ` +
        "`pnpm research:benchmark-build-agent-ready`",
    );
  }
  const packageRoot = packageRootOf(options.cliPath);
  const name = await packageNameOf(packageRoot);
  if (name !== PACKAGE_NAME) {
    throw new AgentReadyCliError(
      `${options.cliPath} does not look like an agent-ready build: expected ${PACKAGE_NAME} at ${packageRoot}, found ${String(name)}`,
    );
  }
  const buildInfo = await readBuildInfo(packageRoot);
  if (buildInfo === undefined) {
    throw new AgentReadyCliError(
      `${options.cliPath} carries no ${BUILD_INFO_FILE}; a trial may only query through a ` +
        `stamped build of ${options.pinnedCommit}. Run \`pnpm research:benchmark-build-agent-ready\`.`,
    );
  }
  if (buildInfo.commit !== options.pinnedCommit) {
    throw new AgentReadyCliError(
      `${options.cliPath} was built from ${buildInfo.commit}, but the run manifest pins ` +
        `${options.pinnedCommit}; build the pinned commit instead of reusing this dist`,
    );
  }
  if (buildInfo.dirty) {
    throw new AgentReadyCliError(
      `${options.cliPath} was built from a modified tree (commit ${buildInfo.commit}, dirty); ` +
        "a trial needs the pinned commit's own source",
    );
  }
  return { cliPath: options.cliPath, packageRoot, buildInfo };
}

async function git(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

async function runCommand(command: string, args: readonly string[], cwd: string): Promise<void> {
  try {
    await execFileAsync(command, [...args], { cwd, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const stderr = (error as { readonly stderr?: unknown } | null)?.stderr;
    const detail = typeof stderr === "string" && stderr.length > 0 ? stderr : String(error);
    throw new AgentReadyCliError(`${command} ${args.join(" ")} failed in ${cwd}: ${detail}`);
  }
}

/**
 * Streams `git archive` into `tar`, so the export carries the commit's files
 * and no Git metadata. POSIX tooling only: the benchmark runs on the Linux
 * environment its run manifest records.
 */
async function exportCommit(
  commit: string,
  repositoryRoot: string,
  destination: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const archive = spawn("git", ["archive", commit], { cwd: repositoryRoot });
    const extract = spawn("tar", ["-x", "-C", destination]);
    let archiveError = "";
    let extractError = "";
    archive.stderr.on("data", (chunk: Buffer) => {
      archiveError += chunk.toString("utf8");
    });
    extract.stderr.on("data", (chunk: Buffer) => {
      extractError += chunk.toString("utf8");
    });
    archive.on("error", reject);
    extract.on("error", reject);
    archive.stdout.pipe(extract.stdin);
    archive.on("close", (code) => {
      if (code !== 0) reject(new Error(`git archive failed for ${commit}: ${archiveError}`));
    });
    extract.on("close", (code) => {
      if (code !== 0) reject(new Error(`tar failed for ${commit}: ${extractError}`));
      else resolve();
    });
  });
}

/**
 * Builds the pinned commit into `build/agent-ready-<commit>`: export the commit,
 * reuse this checkout's installed dependencies (after checking the lockfile and
 * manifest match that commit), run the repository's own build, and stamp the
 * result. The output is verified before it is returned.
 */
export async function buildAgentReadyCli(options: {
  readonly repositoryRoot: string;
  readonly pinnedCommit: string;
  readonly outputRoot?: string;
}): Promise<VerifiedCli> {
  const { repositoryRoot, pinnedCommit } = options;
  try {
    await git(["cat-file", "-e", `${pinnedCommit}^{commit}`], repositoryRoot);
  } catch {
    throw new AgentReadyCliError(
      `commit ${pinnedCommit} is not available in ${repositoryRoot}; fetch it before building`,
    );
  }

  const destination =
    options.outputRoot ??
    join(repositoryRoot, BUILD_DIRECTORY, `agent-ready-${pinnedCommit.slice(0, 12)}`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await exportCommit(pinnedCommit, repositoryRoot, destination);

  // Install from the pinned lockfile rather than borrowing this checkout's
  // node_modules: a branch may legitimately carry different dependency pins.
  const pinnedManifest = JSON.parse(await readFile(join(destination, "package.json"), "utf8")) as {
    readonly packageManager?: unknown;
    readonly version?: unknown;
  };
  const packageManager =
    typeof pinnedManifest.packageManager === "string"
      ? pinnedManifest.packageManager
      : "pnpm@10.0.0";
  await runCommand(
    "npx",
    ["--yes", packageManager, "install", "--frozen-lockfile", "--prefer-offline"],
    destination,
  );

  await runCommand(process.execPath, ["scripts/clean-dist.mjs"], destination);
  await runCommand(
    process.execPath,
    [join(destination, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"],
    destination,
  );

  const parsed = pinnedManifest;
  const buildInfo: BuildInfo = {
    commit: pinnedCommit,
    dirty: false,
    ...(typeof parsed.version === "string" && { version: parsed.version }),
    builtAt: new Date().toISOString(),
  };
  await writeFile(
    join(destination, BUILD_INFO_FILE),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
    "utf8",
  );

  return await verifyAgentReadyCli({
    cliPath: join(destination, "dist", "cli", "index.js"),
    pinnedCommit,
  });
}
