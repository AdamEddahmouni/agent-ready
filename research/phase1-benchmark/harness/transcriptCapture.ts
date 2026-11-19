import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { promisify } from "node:util";
import { normalizeWorkspacePath, resolveWorkspacePath } from "./score.js";

const execFile = promisify(execFileCallback);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Shared parsing and classification for client event streams. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/** Accepts raw JSONL text or an already-parsed event array. */
export function readJsonl(stream: string | readonly unknown[]): readonly unknown[] {
  if (typeof stream !== "string") return stream;
  return stream
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

/** Normalizes a tool's file path to a repository-relative POSIX path. */
export function repositoryPath(filePath: string, workspaceRoot: string): string {
  if (!isAbsolute(filePath)) return normalizeWorkspacePath(filePath);
  const relativePath = relative(workspaceRoot, filePath);
  if (relativePath.length === 0 || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`tool path is outside the workspace: ${JSON.stringify(filePath)}`);
  }
  return relativePath.split(sep).join("/");
}

export type MutationRisk = "none" | "possible" | "certain";

const GIT_READ_ONLY = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "ls-files",
  "grep",
  "blame",
  "describe",
  "cat-file",
]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "npx", "pnpx"]);
const FILE_MUTATORS = new Set([
  "rm",
  "rmdir",
  "mv",
  "cp",
  "ln",
  "mkdir",
  "touch",
  "truncate",
  "dd",
  "patch",
  "tee",
  "chmod",
  "chown",
  "tar",
  "unzip",
  "zip",
]);
const BUILD_TOOLS = new Set([
  "make",
  "prettier",
  "eslint",
  "tsc",
  "vitest",
  "jest",
  "mocha",
  "tsx",
  "cargo",
  "go",
]);
const READ_ONLY = new Set([
  "cat",
  "ls",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "find",
  "pwd",
  "echo",
  "stat",
  "file",
  "diff",
  "sort",
  "uniq",
  "cut",
  "which",
  "type",
  "true",
  "false",
]);
const REDIRECT = /(^|[^0-9&])>>?\s*[^&\s]/;
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);

/**
 * Codex runs every command through `/bin/bash -lc "..."`. Classifying that
 * wrapper would only ever say "bash", so look at the command it carries. A
 * wrapper that cannot be read stays ambiguous rather than looking safe.
 */
function unwrapShellCommand(tokens: readonly string[]): string | undefined {
  const first = tokens[0];
  if (first === undefined) return undefined;
  const executable = first.replaceAll('"', "").replaceAll("'", "");
  const base = executable.slice(executable.lastIndexOf("/") + 1);
  if (!SHELLS.has(base)) return undefined;
  const flagIndex = tokens.findIndex((token) => /^-[a-z]*c$/.test(token));
  if (flagIndex === -1) return undefined;
  const inner = tokens
    .slice(flagIndex + 1)
    .join(" ")
    .replace(/^["']/, "")
    .replace(/["']$/, "");
  return inner.length > 0 ? inner : undefined;
}

function commandSegments(command: string): string[] {
  return command
    .split(/[;&|\n]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function segmentRisk(segment: string): MutationRisk {
  if (REDIRECT.test(segment) && !/>\s*\/dev\/null/.test(segment)) return "certain";
  const tokens = segment.split(/\s+/).filter((token) => token.length > 0);
  const rawExecutable = tokens[0];
  if (rawExecutable === undefined) return "none";
  const wrapped = unwrapShellCommand(tokens);
  if (wrapped !== undefined) return shellMutationRisk(wrapped);
  const executable = rawExecutable.replaceAll('"', "").replaceAll("'", "");

  if (executable === "sed") {
    return tokens.some((token) => /^-i|^--in-place/.test(token)) ? "certain" : "none";
  }
  if (executable === "git") {
    const subcommand = tokens.slice(1).find((token) => !token.startsWith("-"));
    return subcommand !== undefined && GIT_READ_ONLY.has(subcommand) ? "none" : "certain";
  }
  if (READ_ONLY.has(executable)) return "none";
  if (
    PACKAGE_MANAGERS.has(executable) ||
    FILE_MUTATORS.has(executable) ||
    BUILD_TOOLS.has(executable)
  ) {
    return "certain";
  }
  // Interpreters and unknown executables can write; no static check can rule it
  // out, so they are flagged rather than refused.
  return "possible";
}

/** Classifies a shell line. Conservative by construction: quotes are not parsed. */
export function shellMutationRisk(command: string): MutationRisk {
  // This is only a hint about where to look. Whether a mutation actually went
  // unrecorded is decided by `assessShellMutation`, which compares the checkout
  // with the recorded writes instead of trusting the command text.
  let risk: MutationRisk = "none";
  for (const segment of commandSegments(command)) {
    const segmentLevel = segmentRisk(segment);
    if (segmentLevel === "certain") return "certain";
    if (segmentLevel === "possible") risk = "possible";
  }
  return risk;
}

export interface ShellCommandRisk {
  readonly command: string;
  readonly level: MutationRisk;
}

export interface RecordedWrite {
  readonly path: string;
  readonly content: string;
}

export interface ShellMutationAssessment {
  /** True when replay may not reproduce the checkout's changes. */
  readonly risk: boolean;
  /** Explanation to record whenever a mutating command was classified. */
  readonly note?: string;
  /** Present when the capture should be refused unless the caller accepts the gap. */
  readonly refusal?: string;
}

function parseGitStatusPaths(output: string): string[] {
  const records = output.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    // `XY path`; anything shorter than that cannot carry a path.
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    paths.push(record.slice(3).split(sep).join("/"));
    // A rename or copy record is followed by the original path.
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return paths;
}

/**
 * Paths the checkout reports as changed, relative to the workspace root.
 * `undefined` means git could not answer, which is not the same as "nothing
 * changed" and must never be treated as coverage.
 */
export async function changedWorkspacePaths(workspaceRoot: string): Promise<string[] | undefined> {
  try {
    const { stdout } = await execFile(
      "git",
      ["status", "--porcelain", "-z", "--untracked-files=all"],
      { cwd: workspaceRoot, maxBuffer: MAX_GIT_OUTPUT_BYTES },
    );
    return parseGitStatusPaths(stdout);
  } catch {
    return undefined;
  }
}

/**
 * Recorded paths whose bytes on disk no longer match the transcript. A write
 * event is only replayable while the file still holds what was recorded, so a
 * file edited after the capture read it is reported rather than trusted.
 */
async function changedAfterCapture(
  workspaceRoot: string,
  recordedWrites: readonly RecordedWrite[],
): Promise<string[]> {
  const checked = await Promise.all(
    recordedWrites.map(async (write) => {
      try {
        const actual = await readFile(resolveWorkspacePath(workspaceRoot, write.path));
        return actual.equals(Buffer.from(write.content, "utf8")) ? undefined : write.path;
      } catch {
        // A recorded write whose file is now missing or unreadable is a gap too.
        return write.path;
      }
    }),
  );
  return checked.filter((path): path is string => path !== undefined);
}

/**
 * Decides whether the checkout still matches the transcript. The path check
 * always runs: every path git reports as changed must be covered by a recorded
 * write. The byte check runs when the adapter read its content from the
 * checkout. The classifier only says whether a Bash command could explain a
 * gap; it never decides coverage itself.
 */
export async function assessShellMutation(options: {
  readonly workspaceRoot: string;
  readonly recordedWrites: readonly RecordedWrite[];
  readonly commands: readonly ShellCommandRisk[];
  /**
   * Compare each recorded write with the file on disk. Only an adapter that read
   * the content from the checkout can expect the checkout to still hold it;
   * Claude Code's Edit derives content from the tool input instead, so it leaves
   * this off rather than pretending the bytes should match.
   */
  readonly verifyWrittenBytes?: boolean;
}): Promise<ShellMutationAssessment> {
  const mutating = options.commands.filter((risk) => risk.level !== "none");
  const certain = mutating.some((risk) => risk.level === "certain");
  const listed = mutating.map((risk) => JSON.stringify(risk.command)).join(", ");

  const stale =
    options.verifyWrittenBytes === true
      ? await changedAfterCapture(options.workspaceRoot, options.recordedWrites)
      : [];
  if (stale.length > 0) {
    const stalePaths = stale.map((path) => JSON.stringify(path)).join(", ");
    return {
      risk: true,
      note: `the checkout no longer holds the bytes the transcript records for ${stalePaths}`,
      refusal:
        `the checkout no longer holds the bytes the transcript records for ${stalePaths}, ` +
        "so replay would write content the session did not end with. " +
        'Re-convert the log against the untouched checkout, or pass onShellMutation: "flag" to accept the gap.',
    };
  }

  if (mutating.length === 0) return { risk: false };

  const changed = await changedWorkspacePaths(options.workspaceRoot);

  if (changed === undefined) {
    const reason = "the checkout's changed paths could not be checked (git status failed)";
    return {
      risk: true,
      note: `Bash may have changed files without a recorded write: ${reason}; replay is not guaranteed to match this session`,
      ...(certain && {
        refusal:
          `Bash certainly changed files but ${reason}, so replay cannot be confirmed to ` +
          `reproduce this session: ${listed}. Pass onShellMutation: "flag" to accept the gap.`,
      }),
    };
  }

  const recorded = new Set(options.recordedWrites.map((write) => write.path));
  const unrecorded = changed.filter((path) => !recorded.has(path));
  if (unrecorded.length === 0) {
    const certainCount = mutating.filter((risk) => risk.level === "certain").length;
    const possibleCount = mutating.length - certainCount;
    const counted =
      `Bash commands classified as mutations ran (${String(certainCount)} certain, ` +
      `${String(possibleCount)} possible), but `;
    return {
      risk: false,
      note:
        changed.length === 0
          ? `${counted}the checkout reports no changes`
          : `${counted}every path the checkout reports as changed is recorded as a write`,
    };
  }

  const paths = unrecorded.map((path) => JSON.stringify(path)).join(", ");
  return {
    risk: true,
    note: `Bash may have changed files the transcript does not record (${paths}); replay is not guaranteed to match this session`,
    ...(certain && {
      refusal:
        `Bash certainly changed files and the checkout has changes the transcript does not record (${paths}), ` +
        `so replay cannot reproduce this session: ${listed}. ` +
        'Pass onShellMutation: "flag" to accept the gap.',
    }),
  };
}
