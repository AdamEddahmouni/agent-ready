import { isAbsolute, relative, sep } from "node:path";
import { normalizeWorkspacePath } from "./score.js";

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
  let risk: MutationRisk = "none";
  for (const segment of commandSegments(command)) {
    const segmentLevel = segmentRisk(segment);
    if (segmentLevel === "certain") return "certain";
    if (segmentLevel === "possible") risk = "possible";
  }
  return risk;
}
