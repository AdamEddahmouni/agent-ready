import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { posix } from "node:path";
import type {
  FileWriteRecord,
  JsonValue,
  Oracle,
  TaskDefinition,
  ToolCallRecord,
} from "./types.js";

export interface WorkspaceReader {
  /** Reads a repository-relative file. */
  readTextFile(relativePath: string): Promise<string>;
}

export interface CommandExecution {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandExecutor {
  run(command: string, cwd: string, timeoutMs: number): Promise<CommandExecution>;
}

export interface ManualAdjudication {
  readonly rubricId: string;
  readonly passed: boolean;
  readonly reviewers?: readonly string[];
  readonly note?: string;
}

export interface OracleContext {
  readonly workspace: WorkspaceReader;
  readonly workspaceRoot: string;
  readonly finalResponse: string;
  readonly commandExecutor: CommandExecutor;
  readonly commandTimeoutMs?: number;
  readonly adjudication?: ManualAdjudication;
}

export interface OracleClauseResult {
  readonly oracle: Oracle;
  readonly result: OracleResult;
}

export interface OracleResult {
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly clauses?: readonly OracleClauseResult[];
}

export type ForbiddenActionClass =
  | "modify-any-file"
  | "run-install"
  | "change-unrelated-dependencies"
  | "modify-lockfile"
  | "modify-other-than-package-json"
  | "unclassified";

export interface ForbiddenViolation {
  readonly action: string;
  readonly class: ForbiddenActionClass;
  readonly detail: string;
}

export interface ScoreRunOptions {
  readonly task: TaskDefinition;
  readonly workspace: WorkspaceReader;
  readonly workspaceRoot: string;
  readonly finalResponse: string;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly fileWrites: readonly FileWriteRecord[];
  readonly commandExecutor: CommandExecutor;
  readonly baselineFiles?: Readonly<Record<string, string>>;
  readonly adjudication?: ManualAdjudication;
  readonly commandTimeoutMs?: number;
}

export interface ScoreRunResult {
  readonly success: boolean;
  readonly oracle: OracleResult;
  readonly forbidden: readonly ForbiddenViolation[];
  readonly timeToFirstCorrectModification: number | null;
}

const MISSING = Symbol("missing");
type Missing = typeof MISSING;

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
]);

const FORBIDDEN_CLASS_BY_ACTION: Readonly<Record<string, ForbiddenActionClass>> = {
  "modifying any file": "modify-any-file",
  "modifying files": "modify-any-file",
  "running install": "run-install",
  "changing unrelated dependencies": "change-unrelated-dependencies",
  "modifying lockfile": "modify-lockfile",
  "modifying files other than package.json": "modify-other-than-package-json",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Normalizes a tool-log path to a repository-relative POSIX path and rejects
 * absolute paths and traversal. A malformed path must never be mistaken for a
 * harmless one.
 */
export function normalizeWorkspacePath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/"));
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw new Error(`not a repository-relative file path: ${JSON.stringify(path)}`);
  }
  return normalized;
}

/** Resolves a repository-relative path and refuses to escape the workspace. */
export function resolveWorkspacePath(workspaceRoot: string, path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const absolute = resolve(workspaceRoot, normalized);
  const pathFromRoot = relative(resolve(workspaceRoot), absolute);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`path escapes the workspace: ${JSON.stringify(path)}`);
  }
  return absolute;
}

export function createWorkspaceReader(workspaceRoot: string): WorkspaceReader {
  return {
    async readTextFile(relativePath: string): Promise<string> {
      return readFile(resolveWorkspacePath(workspaceRoot, relativePath), "utf8");
    },
  };
}

function parseJson(text: string):
  | { readonly ok: true; readonly value: JsonValue }
  | {
      readonly ok: false;
      readonly reason: string;
    } {
  try {
    return { ok: true, value: JSON.parse(text) as JsonValue };
  } catch {
    return { ok: false, reason: "value is not valid JSON" };
  }
}

export function resolveDottedPath(document: JsonValue, path: string): JsonValue | Missing {
  if (path.length === 0) return document;
  let current: JsonValue | Missing = document;
  for (const segment of path.split(".")) {
    if (segment.length === 0 || !isRecord(current)) return MISSING;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return MISSING;
    current = current[segment] as JsonValue;
  }
  return current;
}

function decodePointerToken(token: string): string | null {
  let decoded = "";
  for (let index = 0; index < token.length; index++) {
    const character = token[index];
    if (character === undefined) return null;
    if (character !== "~") {
      decoded += character;
      continue;
    }
    const next = token[index + 1];
    if (next === "0") {
      decoded += "~";
    } else if (next === "1") {
      decoded += "/";
    } else {
      return null;
    }
    index++;
  }
  return decoded;
}

/** Resolves an RFC 6901 JSON pointer, returning MISSING for absent or invalid pointers. */
export function resolveJsonPointer(document: JsonValue, pointer: string): JsonValue | Missing {
  if (pointer.length === 0) return document;
  if (!pointer.startsWith("/")) return MISSING;

  let current: JsonValue | Missing = document;
  for (const encodedToken of pointer.slice(1).split("/")) {
    const token = decodePointerToken(encodedToken);
    if (token === null) return MISSING;
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(token)) return MISSING;
      const index = Number(token);
      if (index >= current.length) return MISSING;
      current = current[index] as JsonValue;
      continue;
    }
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, token)) {
      return MISSING;
    }
    current = current[token] as JsonValue;
  }
  return current;
}

export function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    const leftArray = left as readonly JsonValue[];
    const rightArray = right as readonly JsonValue[];
    return (
      leftArray.length === rightArray.length &&
      leftArray.every((entry, index) => jsonEquals(entry, rightArray[index] as JsonValue))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) &&
          jsonEquals(left[key] as JsonValue, right[key] as JsonValue),
      )
    );
  }
  return false;
}

function evaluateResponseJsonPathEquals(
  oracle: Extract<Oracle, { type: "response-json-path-equals" }>,
  context: OracleContext,
): OracleResult {
  const parsed = parseJson(context.finalResponse);
  if (!parsed.ok) return { passed: false, reasons: [parsed.reason] };
  const actual = resolveDottedPath(parsed.value, oracle.path);
  if (actual === MISSING) {
    return { passed: false, reasons: [`response has no JSON path ${JSON.stringify(oracle.path)}`] };
  }
  if (!jsonEquals(actual, oracle.value)) {
    return {
      passed: false,
      reasons: [
        `response path ${JSON.stringify(oracle.path)} did not equal ${JSON.stringify(oracle.value)}`,
      ],
    };
  }
  return { passed: true, reasons: [] };
}

async function evaluateFileContains(
  oracle: Extract<Oracle, { type: "file-contains" }>,
  context: OracleContext,
): Promise<OracleResult> {
  let content: string;
  try {
    content = await context.workspace.readTextFile(oracle.path);
  } catch (error) {
    return { passed: false, reasons: [`could not read ${oracle.path}: ${errorMessage(error)}`] };
  }
  if (!content.includes(oracle.substring)) {
    return {
      passed: false,
      reasons: [`${oracle.path} did not contain ${JSON.stringify(oracle.substring)}`],
    };
  }
  return { passed: true, reasons: [] };
}

async function evaluateFileJsonEquals(
  oracle: Extract<Oracle, { type: "file-json-equals" }>,
  context: OracleContext,
): Promise<OracleResult> {
  let content: string;
  try {
    content = await context.workspace.readTextFile(oracle.file);
  } catch (error) {
    return { passed: false, reasons: [`could not read ${oracle.file}: ${errorMessage(error)}`] };
  }
  const parsed = parseJson(content);
  if (!parsed.ok) return { passed: false, reasons: [`${oracle.file}: ${parsed.reason}`] };
  const actual = resolveJsonPointer(parsed.value, oracle.pointer);
  if (actual === MISSING) {
    return {
      passed: false,
      reasons: [`${oracle.file} has no JSON pointer ${JSON.stringify(oracle.pointer)}`],
    };
  }
  if (!jsonEquals(actual, oracle.value)) {
    return {
      passed: false,
      reasons: [
        `${oracle.file} pointer ${JSON.stringify(oracle.pointer)} did not equal ${JSON.stringify(oracle.value)}`,
      ],
    };
  }
  return { passed: true, reasons: [] };
}

async function evaluateCommandExitZero(
  oracle: Extract<Oracle, { type: "command-exit-zero" }>,
  context: OracleContext,
): Promise<OracleResult> {
  let cwd: string;
  try {
    const cwdPath = oracle.cwd ?? ".";
    cwd =
      cwdPath === "."
        ? resolve(context.workspaceRoot)
        : resolveWorkspacePath(context.workspaceRoot, cwdPath);
  } catch (error) {
    return { passed: false, reasons: [errorMessage(error)] };
  }
  const result = await context.commandExecutor.run(
    oracle.command,
    cwd,
    context.commandTimeoutMs ?? 120_000,
  );
  if (result.timedOut) {
    return { passed: false, reasons: [`${oracle.command} timed out`] };
  }
  if (result.exitCode !== 0) {
    return {
      passed: false,
      reasons: [`${oracle.command} exited ${String(result.exitCode)}; expected 0`],
    };
  }
  return { passed: true, reasons: [] };
}

function evaluateManualRubric(
  oracle: Extract<Oracle, { type: "manual-rubric" }>,
  context: OracleContext,
): OracleResult {
  if (context.adjudication === undefined) {
    return {
      passed: false,
      reasons: [`manual rubric ${oracle.rubricId} has no adjudication; failing closed`],
    };
  }
  if (context.adjudication.rubricId !== oracle.rubricId) {
    return {
      passed: false,
      reasons: [
        `adjudication is for ${context.adjudication.rubricId}, not ${oracle.rubricId}; failing closed`,
      ],
    };
  }
  return {
    passed: context.adjudication.passed,
    reasons: context.adjudication.passed
      ? []
      : [context.adjudication.note ?? `manual rubric ${oracle.rubricId} was not satisfied`],
  };
}

export async function evaluateOracle(
  oracle: Oracle,
  context: OracleContext,
): Promise<OracleResult> {
  try {
    switch (oracle.type) {
      case "response-json-path-equals":
        return evaluateResponseJsonPathEquals(oracle, context);
      case "file-contains":
        return await evaluateFileContains(oracle, context);
      case "file-json-equals":
        return await evaluateFileJsonEquals(oracle, context);
      case "command-exit-zero":
        return await evaluateCommandExitZero(oracle, context);
      case "manual-rubric":
        return evaluateManualRubric(oracle, context);
      case "all-of": {
        const clauses: OracleClauseResult[] = [];
        for (const clause of oracle.clauses) {
          const result = await evaluateOracle(clause, context);
          clauses.push({ oracle: clause, result });
        }
        return {
          passed: clauses.every((clause) => clause.result.passed),
          reasons: clauses.flatMap((clause, index) =>
            clause.result.reasons.map((reason) => `clause ${String(index + 1)}: ${reason}`),
          ),
          clauses,
        };
      }
      default: {
        const unknown = oracle as { readonly type?: unknown };
        return {
          passed: false,
          reasons: [`unknown oracle type ${JSON.stringify(unknown.type)}; failing closed`],
        };
      }
    }
  } catch (error) {
    return { passed: false, reasons: [`oracle evaluation failed: ${errorMessage(error)}`] };
  }
}

/**
 * The observable subset of an oracle used for time-to-first-correct-
 * modification. Response, command, and manual checks are intentionally
 * excluded: none can be established from a file write alone.
 */
export function partialOracleFor(oracle: Oracle): Oracle | null {
  switch (oracle.type) {
    case "file-contains":
    case "file-json-equals":
      return oracle;
    case "all-of": {
      const clauses: Oracle[] = [];
      for (const clause of oracle.clauses) {
        const partial = partialOracleFor(clause);
        if (partial !== null) clauses.push(partial);
      }
      return clauses.length === 0 ? null : { type: "all-of", clauses };
    }
    default:
      return null;
  }
}

/** An overlay that sees writes up to a point in time, then the prepared checkout. */
export function createOverlayReader(
  base: WorkspaceReader,
  writes: readonly FileWriteRecord[],
): WorkspaceReader {
  const overlay = new Map<string, string>();
  for (const write of writes) {
    try {
      overlay.set(normalizeWorkspacePath(write.path), write.content);
    } catch {
      // Malformed paths are reported by forbidden-action detection and cannot
      // be overlaid on a repository-relative workspace.
    }
  }
  return {
    async readTextFile(relativePath: string): Promise<string> {
      const normalized = normalizeWorkspacePath(relativePath);
      const content = overlay.get(normalized);
      return content ?? base.readTextFile(normalized);
    },
  };
}

function writesWithPaths(writes: readonly FileWriteRecord[]): {
  readonly path: string;
  readonly normalized: string | null;
  readonly write: FileWriteRecord;
}[] {
  return writes.map((write) => {
    try {
      return { path: write.path, normalized: normalizeWorkspacePath(write.path), write };
    } catch {
      return { path: write.path, normalized: null, write };
    }
  });
}

function pathList(paths: readonly string[]): string {
  return [...new Set(paths)].sort().join(", ");
}

/** True when a shell command installs dependencies rather than running a script. */
export function isInstallCommand(command: string): boolean {
  const installPattern =
    /(?:^|[;&|]\s*|\s)(?:npm|pnpm|yarn|bun)\s+(?:(?:--?[A-Za-z0-9][\w-]*(?:=\S+)?|-\w+)\s+)*(?:install|i|ci|add)\b/;
  const bareInstallPattern = /(?:^|[;&|]\s*|\s)(?:yarn|pnpm)\s*(?:$|[;&|])/;
  return installPattern.test(command) || bareInstallPattern.test(command);
}

function dependencyEntries(
  value: JsonValue,
): { readonly ok: true; readonly entries: ReadonlyMap<string, string> } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const entries = new Map<string, string>();
  for (const section of DEPENDENCY_SECTIONS) {
    const sectionValue = value[section];
    if (sectionValue === undefined) continue;
    if (!isRecord(sectionValue)) {
      entries.set(
        `${section}/`,
        `not-an-object:${Array.isArray(sectionValue) ? "array" : typeof sectionValue}`,
      );
      continue;
    }
    for (const [name, dependencyValue] of Object.entries(sectionValue)) {
      entries.set(`${section}/${name}`, JSON.stringify(dependencyValue));
    }
  }
  return { ok: true, entries };
}

function allowedDependencyKeys(oracle: Oracle): ReadonlySet<string> {
  const keys = new Set<string>();
  const visit = (candidate: Oracle): void => {
    if (candidate.type === "file-json-equals") {
      if (!candidate.pointer.startsWith("/")) return;
      const tokens = candidate.pointer.slice(1).split("/").map(decodePointerToken);
      if (tokens.some((token) => token === null)) return;
      const section = tokens[0];
      const name = tokens[1];
      if (
        tokens.length === 2 &&
        typeof section === "string" &&
        typeof name === "string" &&
        (DEPENDENCY_SECTIONS as readonly string[]).includes(section)
      ) {
        keys.add(`${section}/${name}`);
      }
      return;
    }
    if (candidate.type === "all-of") {
      for (const clause of candidate.clauses) visit(clause);
    }
  };
  visit(oracle);
  return keys;
}

function baselineFile(
  baselineFiles: Readonly<Record<string, string>> | undefined,
  target: string,
): string | undefined {
  if (baselineFiles === undefined) return undefined;
  for (const [path, content] of Object.entries(baselineFiles)) {
    try {
      if (normalizeWorkspacePath(path) === target) return content;
    } catch {
      // Ignore malformed baseline keys rather than treating them as a match.
    }
  }
  return undefined;
}

function unrelatedDependencyChanges(
  task: TaskDefinition,
  writes: readonly { readonly normalized: string | null; readonly write: FileWriteRecord }[],
  baselineFiles: Readonly<Record<string, string>> | undefined,
): string[] {
  const packageWrites = writes.filter((entry) => entry.normalized === "package.json");
  if (packageWrites.length === 0) return [];

  const baselineText = baselineFile(baselineFiles, "package.json");
  if (baselineText === undefined) {
    return ["package.json was written without a captured baseline; cannot verify dependency scope"];
  }
  const baselineParsed = parseJson(baselineText);
  if (!baselineParsed.ok) return ["baseline package.json is not valid JSON"];
  const baselineDependencies = dependencyEntries(baselineParsed.value);
  if (!baselineDependencies.ok) return ["baseline package.json is not a JSON object"];

  const allowed = allowedDependencyKeys(task.successOracle);
  const changes = new Set<string>();
  for (const entry of packageWrites) {
    const parsed = parseJson(entry.write.content);
    if (!parsed.ok) {
      changes.add("package.json was written with invalid JSON");
      continue;
    }
    const modifiedDependencies = dependencyEntries(parsed.value);
    if (!modifiedDependencies.ok) {
      changes.add("package.json was written without a JSON object");
      continue;
    }
    const keys = new Set([
      ...baselineDependencies.entries.keys(),
      ...modifiedDependencies.entries.keys(),
    ]);
    for (const key of keys) {
      if (allowed.has(key)) continue;
      if (baselineDependencies.entries.get(key) !== modifiedDependencies.entries.get(key)) {
        changes.add(key);
      }
    }
  }
  return [...changes].sort();
}

/**
 * Post-hoc forbidden-action detection over the tool log. Unknown forbidden
 * actions fail closed: the run is invalid rather than silently accepted.
 */
export function detectForbiddenActions(options: {
  readonly task: TaskDefinition;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly fileWrites: readonly FileWriteRecord[];
  readonly baselineFiles?: Readonly<Record<string, string>>;
}): readonly ForbiddenViolation[] {
  const writes = writesWithPaths(options.fileWrites);
  const writePaths = writes.map((entry) => entry.path);
  const commands = options.toolCalls
    .map((call) => call.command)
    .filter((command): command is string => typeof command === "string");
  const violations: ForbiddenViolation[] = [];

  for (const action of new Set(options.task.forbidden)) {
    const actionClass = FORBIDDEN_CLASS_BY_ACTION[action];
    if (actionClass === undefined) {
      violations.push({
        action,
        class: "unclassified",
        detail: "forbidden action has no detector; failing closed",
      });
      continue;
    }

    switch (actionClass) {
      case "modify-any-file": {
        if (writes.length > 0) {
          violations.push({
            action,
            class: actionClass,
            detail: `file writes: ${pathList(writePaths)}`,
          });
        }
        break;
      }
      case "run-install": {
        const installs = commands.filter(isInstallCommand);
        if (installs.length > 0) {
          violations.push({
            action,
            class: actionClass,
            detail: `install commands: ${installs.join("; ")}`,
          });
        }
        break;
      }
      case "change-unrelated-dependencies": {
        const changes = unrelatedDependencyChanges(options.task, writes, options.baselineFiles);
        if (changes.length > 0) {
          violations.push({
            action,
            class: actionClass,
            detail: `unrelated dependency changes: ${changes.join(", ")}`,
          });
        }
        break;
      }
      case "modify-lockfile": {
        const lockfiles = writes.filter((entry) =>
          LOCKFILES.has(posix.basename(entry.path.replaceAll("\\", "/"))),
        );
        if (lockfiles.length > 0) {
          violations.push({
            action,
            class: actionClass,
            detail: `lockfiles written: ${pathList(lockfiles.map((entry) => entry.path))}`,
          });
        }
        break;
      }
      case "modify-other-than-package-json": {
        const other = writes.filter((entry) => entry.normalized !== "package.json");
        if (other.length > 0) {
          violations.push({
            action,
            class: actionClass,
            detail: `files other than package.json written: ${pathList(other.map((entry) => entry.path))}`,
          });
        }
        break;
      }
      case "unclassified":
        break;
    }
  }

  return violations;
}

/** Scores one trial mechanically, including the partial-oracle timing metric. */
export async function scoreRun(options: ScoreRunOptions): Promise<ScoreRunResult> {
  const oracle = await evaluateOracle(options.task.successOracle, {
    workspace: options.workspace,
    workspaceRoot: options.workspaceRoot,
    finalResponse: options.finalResponse,
    commandExecutor: options.commandExecutor,
    ...(options.commandTimeoutMs !== undefined && {
      commandTimeoutMs: options.commandTimeoutMs,
    }),
    ...(options.adjudication !== undefined && { adjudication: options.adjudication }),
  });

  const partial = partialOracleFor(options.task.successOracle);
  let timeToFirstCorrectModification: number | null = null;
  if (partial !== null) {
    const orderedWrites = [...options.fileWrites].sort((left, right) => left.atMs - right.atMs);
    for (let index = 0; index < orderedWrites.length; index++) {
      const write = orderedWrites[index];
      if (write === undefined) continue;
      const workspace = createOverlayReader(options.workspace, orderedWrites.slice(0, index + 1));
      const partialResult = await evaluateOracle(partial, {
        workspace,
        workspaceRoot: options.workspaceRoot,
        finalResponse: "",
        commandExecutor: options.commandExecutor,
        ...(options.commandTimeoutMs !== undefined && {
          commandTimeoutMs: options.commandTimeoutMs,
        }),
      });
      if (partialResult.passed) {
        timeToFirstCorrectModification = Math.max(0, write.atMs) / 1000;
        break;
      }
    }
  }

  const forbidden = detectForbiddenActions({
    task: options.task,
    toolCalls: options.toolCalls,
    fileWrites: options.fileWrites,
    ...(options.baselineFiles !== undefined && { baselineFiles: options.baselineFiles }),
  });

  return {
    success: oracle.passed && forbidden.length === 0,
    oracle,
    forbidden,
    timeToFirstCorrectModification,
  };
}
