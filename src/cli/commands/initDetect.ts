import type { FileSystem } from "../../filesystem/types.js";
import { joinPath } from "../../filesystem/pathJoin.js";

// ── Public detection type ──────────────────────────────────────────────────

export interface InitDetection {
  /** Detected project name (from package.json "name" or directory name). */
  readonly projectName: string;
  /** Source of the project name: "package.json" or "directory". */
  readonly projectNameSource: "package.json" | "directory";
  /** Whether the project name was sanitized to fit the schema pattern. */
  readonly projectNameSanitized: boolean;
  /** Detected project description (from package.json "description"), if any. */
  readonly projectDescription?: string;
  /** Detected Node version range (from package.json engines.node, .nvmrc, or .node-version). */
  readonly nodeRange?: string;
  /** Source of the Node range. */
  readonly nodeRangeSource?: "engines.node" | ".nvmrc" | ".node-version";
  /** Detected package manager (from package.json packageManager or lock files). */
  readonly packageManager?: { readonly name: "npm" | "pnpm" | "yarn"; readonly version: string };
  /** Source of the package manager detection. */
  readonly packageManagerSource?: "package.json" | "pnpm-lock.yaml" | "yarn.lock" | "package-lock.json";
  /** Well-known scripts detected in package.json, ready for commands block. */
  readonly detectedScripts: Readonly<Record<string, string>>;
  /** Script keys from package.json that were skipped (not in the well-known set). */
  readonly skippedScripts: readonly string[];
  /** Script names recommended for verification.required (subset of detectedScripts keys). */
  readonly verificationScripts: readonly string[];
  /** Existing documentation files detected at the repo root. */
  readonly docSources: readonly string[];
  /** Path patterns detected from .gitignore suitable for paths.ignored. */
  readonly ignoredPatterns: readonly string[];
  /** Path patterns from .gitignore that were skipped (unsupported syntax). */
  readonly skippedGitignorePatterns: readonly string[];
  /** Whether a .env* pattern appears in .gitignore (suggests paths.protected). */
  readonly hasEnvInGitignore: boolean;
}

// ── Well-known script names and verification subset ────────────────────────

const WELL_KNOWN_SCRIPTS = new Set([
  "lint",
  "test",
  "build",
  "typecheck",
  "format",
  "check",
  "test-e2e",
  "ci",
]);

const VERIFICATION_SCRIPTS = new Set(["lint", "typecheck", "test", "build"]);

// ── Orchestration ──────────────────────────────────────────────────────────

/**
 * Runs all detection heuristics against the repository root and returns
 * a consolidated InitDetection. Each heuristic degrades gracefully when
 * its source artifact is missing or malformed — detection never throws.
 */
export async function detectAll(fs: FileSystem, repoRoot: string): Promise<InitDetection> {
  const pkg = await readPackageJson(fs, repoRoot);

  const pm = detectPackageManager(pkg, fs, repoRoot);
  const nodeRange = detectNodeRange(pkg, fs, repoRoot);
  const scripts = detectScripts(pkg);
  const verificationScripts = detectVerificationScripts(pkg);
  const docSources = await detectDocSources(fs, repoRoot);
  const paths = await detectPaths(fs, repoRoot);
  const projectName = detectProjectName(pkg, repoRoot);

  return {
    ...projectName,
    ...(pkg !== undefined &&
      pkg["description"] !== undefined &&
      typeof pkg["description"] === "string" &&
      (pkg["description"] as string).length >= 1 &&
      (pkg["description"] as string).length <= 500 && { projectDescription: pkg["description"] }),
    ...(nodeRange.range !== undefined && {
      nodeRange: nodeRange.range,
      nodeRangeSource: nodeRange.source,
    }),
    ...(pm !== undefined && {
      packageManager: { name: pm.name, version: pm.version },
      packageManagerSource: pm.source,
    }),
    detectedScripts: scripts.included,
    skippedScripts: scripts.skipped,
    verificationScripts,
    docSources,
    ignoredPatterns: paths.included,
    skippedGitignorePatterns: paths.skipped,
    hasEnvInGitignore: paths.hasEnv,
  };
}

// ── package.json reader ────────────────────────────────────────────────────

type PackageJson = Record<string, unknown>;

async function readPackageJson(fs: FileSystem, repoRoot: string): Promise<PackageJson | undefined> {
  const pkgPath = joinPath(repoRoot, "package.json");
  const stat = await fs.stat(pkgPath);
  if (!stat?.isFile) return undefined;
  try {
    const raw = await fs.readTextFile(pkgPath);
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as PackageJson;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ── Project name ───────────────────────────────────────────────────────────

const PROJECT_NAME_PATTERN = /^\S(?:.*\S)?$/;

function detectProjectName(
  pkg: PackageJson | undefined,
  repoRoot: string,
): { projectName: string; projectNameSource: "package.json" | "directory"; projectNameSanitized: boolean } {
  // Try package.json "name" first.
  if (pkg !== undefined && typeof pkg["name"] === "string" && pkg["name"].length > 0) {
    let name: string = pkg["name"];
    // Strip npm scope prefix (@scope/).
    const scopeMatch = /^@[^/]+\/(.+)$/.exec(name);
    if (scopeMatch !== null) {
      name = scopeMatch[1] ?? name;
    }
    if (isValidProjectName(name)) {
      return { projectName: name, projectNameSource: "package.json", projectNameSanitized: false };
    }
    const sanitized = sanitizeProjectName(name);
    return { projectName: sanitized, projectNameSource: "package.json", projectNameSanitized: true };
  }

  // Fall back to directory name.
  const dirName = repoRoot.split(/[/\\]/).filter(Boolean).pop() ?? "my-project";
  if (isValidProjectName(dirName)) {
    return { projectName: dirName, projectNameSource: "directory", projectNameSanitized: false };
  }
  const sanitized = sanitizeProjectName(dirName);
  return { projectName: sanitized, projectNameSource: "directory", projectNameSanitized: true };
}

function isValidProjectName(name: string): boolean {
  return name.length >= 1 && name.length <= 100 && PROJECT_NAME_PATTERN.test(name);
}

function sanitizeProjectName(name: string): string {
  return name
    .replace(/\s+/g, "-")
    .slice(0, 100)
    .replace(/^[-]+/, "")
    .replace(/[-]+$/, "")
    || "my-project";
}

// ── Node runtime ───────────────────────────────────────────────────────────

interface NodeRangeResult {
  readonly range?: string;
  readonly source?: "engines.node" | ".nvmrc" | ".node-version";
}

function detectNodeRange(
  pkg: PackageJson | undefined,
  fs: FileSystem,
  repoRoot: string,
): NodeRangeResult {
  // 1. Try package.json engines.node
  if (pkg !== undefined) {
    const engines = pkg["engines"];
    if (typeof engines === "object" && engines !== null && !Array.isArray(engines)) {
      const node = (engines as Record<string, unknown>)["node"];
      if (typeof node === "string" && node.length > 0 && node !== "*") {
        return { range: node, source: "engines.node" };
      }
    }
  }

  // 2. Fall back to .nvmrc / .node-version (sync check — detection must
  //    be async, so we try both in the orchestrator). We'll handle this
  //    in detectAll by calling the helper below.
  return {};
}

/**
 * Reads a runtime-version hint file (.nvmrc or .node-version) and converts
 * the version string to a semver range. Called after the engines.node check
 * in detectNodeRange returned empty.
 */
async function detectNodeRangeFromHintFiles(
  fs: FileSystem,
  repoRoot: string,
): Promise<NodeRangeResult> {
  // .nvmrc preferred
  const nvmrc = await readSingleLineFile(fs, joinPath(repoRoot, ".nvmrc"));
  if (nvmrc !== undefined) {
    const range = versionToRange(nvmrc);
    return { range, source: ".nvmrc" };
  }

  const nodeVersion = await readSingleLineFile(fs, joinPath(repoRoot, ".node-version"));
  if (nodeVersion !== undefined) {
    const range = versionToRange(nodeVersion);
    return { range, source: ".node-version" };
  }

  return {};
}

/**
 * Converts a version string (e.g. "20", "20.10", "20.10.0", "v20.10.0") to a semver
 * range. Single-part → next-major upper bound; two-part → next-minor upper bound;
 * three-part+ → next-major upper bound preserving minor (per ADR-0025).
 */
function versionToRange(version: string): string {
  const cleaned = version.replace(/^v/, "").trim();
  const parts = cleaned.split(".");
  if (parts.length === 1) {
    const major = Number.parseInt(parts[0] ?? "0", 10);
    if (!Number.isFinite(major)) return `>=${cleaned}`;
    return `>=${major} <${major + 1}`;
  }
  if (parts.length === 2) {
    const major = Number.parseInt(parts[0] ?? "0", 10);
    const minor = Number.parseInt(parts[1] ?? "0", 10);
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return `>=${cleaned}`;
    return `>=${major}.${minor} <${major}.${minor + 1}`;
  }
  // Three-part or longer: next-major upper bound, preserving minor (per ADR-0025).
  const major = Number.parseInt(parts[0] ?? "0", 10);
  const minor = Number.parseInt(parts[1] ?? "0", 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return `>=${cleaned}`;
  return `>=${major}.${minor}.0 <${major + 1}`;
}

// ── Package manager ────────────────────────────────────────────────────────

interface PackageManagerResult {
  readonly name: "npm" | "pnpm" | "yarn";
  readonly version: string;
  readonly source: "package.json" | "pnpm-lock.yaml" | "yarn.lock" | "package-lock.json";
}

function detectPackageManager(
  pkg: PackageJson | undefined,
  _fs: FileSystem,
  _repoRoot: string,
): PackageManagerResult | undefined {
  // 1. Try package.json packageManager field (e.g. "pnpm@10.0.0").
  if (pkg !== undefined) {
    const pm = pkg["packageManager"];
    if (typeof pm === "string" && pm.length > 0) {
      const parsed = parsePackageManagerField(pm);
      if (parsed !== undefined) {
        return { ...parsed, source: "package.json" };
      }
    }
  }
  return undefined;
}

function parsePackageManagerField(raw: string): { name: "npm" | "pnpm" | "yarn"; version: string } | undefined {
  const match = /^(npm|pnpm|yarn)@(.+)$/.exec(raw);
  if (match === null) return undefined;
  const name = match[1] as "npm" | "pnpm" | "yarn";
  const version = match[2] ?? "";
  if (version.length === 0) return undefined;
  return { name, version };
}

/**
 * Detects package manager from lock files at the repo root. Called after
 * the packageManager field check returns undefined.
 */
async function detectPackageManagerFromLockFiles(
  fs: FileSystem,
  repoRoot: string,
): Promise<PackageManagerResult | undefined> {
  const checks: Array<{ file: string; name: "npm" | "pnpm" | "yarn"; version: string; source: PackageManagerResult["source"] }> = [
    { file: "pnpm-lock.yaml", name: "pnpm", version: "10", source: "pnpm-lock.yaml" },
    { file: "yarn.lock", name: "yarn", version: "1", source: "yarn.lock" },
    { file: "package-lock.json", name: "npm", version: "10", source: "package-lock.json" },
  ];

  for (const check of checks) {
    const stat = await fs.stat(joinPath(repoRoot, check.file));
    if (stat?.isFile) {
      return { name: check.name, version: check.version, source: check.source };
    }
  }

  return undefined;
}

// ── Scripts ────────────────────────────────────────────────────────────────

interface ScriptsResult {
  readonly included: Readonly<Record<string, string>>;
  readonly skipped: readonly string[];
}

function detectScripts(pkg: PackageJson | undefined): ScriptsResult {
  if (pkg === undefined) return { included: {}, skipped: [] };

  const scripts = pkg["scripts"];
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
    return { included: {}, skipped: [] };
  }

  const included: Record<string, string> = {};
  const skipped: string[] = [];

  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (WELL_KNOWN_SCRIPTS.has(key)) {
      included[key] = value;
    } else {
      skipped.push(key);
    }
  }

  return { included, skipped };
}

function detectVerificationScripts(pkg: PackageJson | undefined): readonly string[] {
  if (pkg === undefined) return [];

  const scripts = pkg["scripts"];
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
    return [];
  }

  // Preserve the order they appear in package.json scripts.
  const result: string[] = [];
  for (const key of Object.keys(scripts)) {
    if (VERIFICATION_SCRIPTS.has(key)) {
      result.push(key);
    }
  }
  return result;
}

// ── Documentation sources ──────────────────────────────────────────────────

async function detectDocSources(fs: FileSystem, repoRoot: string): Promise<readonly string[]> {
  const candidates = ["README.md", "CONTRIBUTING.md"];
  const found: string[] = [];

  for (const candidate of candidates) {
    const stat = await fs.stat(joinPath(repoRoot, candidate));
    if (stat?.isFile) found.push(candidate);
  }

  // Check docs/*.md (one level deep only).
  const docsDir = joinPath(repoRoot, "docs");
  const docsStat = await fs.stat(docsDir);
  if (docsStat?.isDirectory) {
    // We can't list directories through the FileSystem interface, so we
    // probe common filenames and let the detection-summary comment note
    // any docs/ directory presence.
    //
    // The ADR says: check for any .md files directly under docs/. Since
    // FileSystem has no readdir, we can't enumerate. Instead, we note
    // docs/ exists and leave the user to curate. This is a known
    // limitation of the detection surface.
    //
    // We still probe a few common names.
    const commonDocs = ["architecture.md", "contributing.md", "development.md", "setup.md"];
    for (const doc of commonDocs) {
      const stat = await fs.stat(joinPath(docsDir, doc));
      if (stat?.isFile) found.push(`docs/${doc}`);
    }
  }

  return found;
}

// ── Paths (.gitignore) ─────────────────────────────────────────────────────

interface PathsResult {
  readonly included: readonly string[];
  readonly skipped: readonly string[];
  readonly hasEnv: boolean;
}

async function detectPaths(fs: FileSystem, repoRoot: string): Promise<PathsResult> {
  const gitignorePath = joinPath(repoRoot, ".gitignore");
  const stat = await fs.stat(gitignorePath);
  if (!stat?.isFile) return { included: [], skipped: [], hasEnv: false };

  let raw: string;
  try {
    raw = await fs.readTextFile(gitignorePath);
  } catch {
    return { included: [], skipped: [], hasEnv: false };
  }

  const lines = raw.split(/\r?\n/);
  const included: string[] = [];
  const skipped: string[] = [];
  let hasEnv = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    // Negation patterns are skipped (init doesn't auto-include negations).
    if (line.startsWith("!")) {
      skipped.push(line);
      continue;
    }

    // Check for unsupported glob syntax (extglobs, unbalanced brackets/braces).
    if (hasUnsupportedGlobSyntax(line)) {
      skipped.push(line);
      continue;
    }

    included.push(line);

    // Check for .env* patterns.
    if (line === ".env" || line === ".env*" || line.startsWith(".env*")) {
      hasEnv = true;
    }
  }

  return { included, skipped, hasEnv };
}

/**
 * Returns true if the pattern contains unsupported glob syntax (extglobs
 * like @(...), +(...), ?(...), !(negation inside extglob), or unbalanced
 * brackets/braces). The ADR says init only auto-includes patterns in the
 * schema's supported glob subset.
 */
function hasUnsupportedGlobSyntax(pattern: string): boolean {
  // Extglobs: @(...), +(...), ?(...), !(...), *(...)
  if (/[@+!*?]\(/.test(pattern)) return true;
  // Unbalanced [ or {
  const openBrackets = (pattern.match(/\[/g) ?? []).length;
  const closeBrackets = (pattern.match(/\]/g) ?? []).length;
  if (openBrackets !== closeBrackets) return true;
  const openBraces = (pattern.match(/\{/g) ?? []).length;
  const closeBraces = (pattern.match(/\}/g) ?? []).length;
  if (openBraces !== closeBraces) return true;
  return false;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function readSingleLineFile(fs: FileSystem, absolutePath: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat?.isFile) return undefined;
    const raw = await fs.readTextFile(absolutePath);
    const firstLine = raw.split(/\r?\n/)[0];
    return firstLine?.trim() || undefined;
  } catch {
    return undefined;
  }
}

// ── Re-export for use by init.ts orchestrator ──────────────────────────────

export { detectNodeRangeFromHintFiles, detectPackageManagerFromLockFiles };
