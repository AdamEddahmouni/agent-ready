/**
 * Deciding which files are source (ADR-0047 §11).
 *
 * There are two strategies and the choice is per package, not per repository:
 *
 *  - **TypeScript's own configuration**, when the package directory holds a
 *    `tsconfig.json`. The config, its `extends` chain, and its compiler options
 *    are resolved by `ts.parseJsonConfigFileContent` over a repository-fenced
 *    host, because that is where the `extends` and `compilerOptions` semantics
 *    live and re-implementing them is how a tool ends up disagreeing with the
 *    compiler. The resolved `files`/`include`/`exclude` are then applied by a
 *    bounded walk here, using ADR-0005's published glob subset.
 *  - **A bounded traversal**, when there is no config. Deliberately blind: it
 *    excludes `node_modules` and `.git` and nothing else, because "this
 *    directory looks like build output" is a guess, and a guess that silently
 *    drops files produces a graph that is quietly incomplete.
 *
 * The strategy is published in `graph.sourceUniverse.strategy` so a consumer
 * can see that a repository did not state a universe, rather than inferring
 * that from a file list which happens to look reasonable.
 */

import ts from "typescript";
import { matchesGlobPattern } from "../../contract/globMatch.js";
import { normalizePathPattern } from "../../contract/paths.js";
import { joinPath } from "../../filesystem/pathJoin.js";
import { compareCodeUnits } from "../ordering.js";
import type { DiscoveryProbeContext } from "../probe.js";
import { safeList, safeRead } from "../read.js";
import { NEVER_TRAVERSED_DIRECTORIES } from "../packages/expand.js";
import { REPOSITORY_ROOT, isRepositoryRelativePath, sourceExtensionOf } from "./provenance.js";

/**
 * The source extensions this version analyses.
 *
 * A fixed list, not a heuristic. Every extension here has module semantics this
 * code understands, and an extension it does not understand is one whose imports
 * could not be extracted without guessing — so a `.vue` or `.svelte` file stays
 * out of the universe rather than entering it half-read.
 *
 * Declaration files are deliberately **absent**: `sourceExtensionOf` reports
 * `.d.ts` as its own extension precisely so a declaration file is never
 * mistaken for the `.ts` module it describes. A graph edge to a declaration file
 * would assert a runtime relationship that does not exist.
 */
export const SUPPORTED_SOURCE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
];

/** Maximum directory depth either walk reaches. */
export const MAX_SOURCE_DEPTH = 12;

/** Maximum directory entries enumerated across every package's walk. */
export const MAX_SOURCE_ENTRIES = 2000;

/** Maximum files admitted to the module universe. */
export const MAX_SOURCE_FILES = 2000;

/** Maximum size of one source file. Mirrors ADR-0045's manifest cap. */
export const MAX_SOURCE_FILE_BYTES = 1_000_000;

/** Maximum total source bytes parsed, so many large files cannot win. */
export const MAX_TOTAL_SOURCE_BYTES = 32_000_000;

/** Maximum import declarations extracted from one file. */
export const MAX_IMPORTS_PER_FILE = 500;

/** Maximum nodes in one graph. */
export const MAX_GRAPH_NODES = 5000;

/** Maximum edges in one graph. */
export const MAX_GRAPH_EDGES = 20_000;

/** The tsconfig filename consulted per package directory. */
export const TSCONFIG_FILENAME = "tsconfig.json";

/** TypeScript's own default `exclude` when a config states none. */
const TYPESCRIPT_DEFAULT_EXCLUDES: readonly string[] = [
  "node_modules",
  "bower_components",
  "jspm_packages",
];

/**
 * The resolution settings one package's imports are resolved under.
 *
 * Per package rather than once per repository, because a monorepo may resolve
 * one package's imports under `NodeNext` and another's under `Bundler`, and
 * using one mode for both would be a silent claim about code this version has
 * not read.
 */
export interface PackageResolution {
  readonly moduleResolution: ts.ModuleResolutionKind;
  readonly baseUrl: string | undefined;
  readonly paths: ts.MapLike<string[]> | undefined;
}

/**
 * A selected source file and the package that owns it.
 *
 * `packagePath` is decided by containment against the *discovered package
 * roots*, deepest first, not by which config listed the file. A root
 * `tsconfig.json` whose `include` reaches into `packages/api` would otherwise
 * hand that package's files to the root package.
 */
export interface SourceFile {
  readonly path: string;
  readonly packagePath: string;
}

/** What selecting the source universe produced, and what it cost. */
export interface SourceUniverseResult {
  /** Universe files, code-unit sorted, deduplicated by path. */
  readonly files: readonly SourceFile[];
  /**
   * Every repository file resolution may *land on*, unfiltered by extension.
   *
   * Wider than `files` on purpose: a `.json` module and a `.d.ts` are legitimate
   * import targets even though neither is a module node. Dropping them from the
   * resolvable set would report a real import as unresolved.
   */
  readonly resolvable: ReadonlySet<string>;
  /** Repository-relative tsconfig paths that were parsed, code-unit sorted. */
  readonly tsconfigs: readonly string[];
  /** What decided the file list. */
  readonly strategy: "tsconfig" | "bounded-traversal" | "mixed";
  readonly resolutions: ReadonlyMap<string, PackageResolution>;
  /** True when a bound stopped selection. */
  readonly truncated: boolean;
  /** Which bound stopped it, or null. */
  readonly truncatedBy: string | null;
  /**
   * A `tsconfig` include/exclude pattern outside ADR-0005's glob subset.
   *
   * Surfaced rather than applied: a pattern this code cannot evaluate is a
   * pattern whose effect on the universe is unknown, and an unknown effect on a
   * file list is exactly the quiet narrowing the graph exists to prevent.
   */
  readonly unsupportedPatterns: readonly { readonly source: string; readonly pattern: string }[];
  /**
   * A `tsconfig` that could not be used, so the package fell back to traversal.
   *
   * An `extends` target outside the repository lands here: repository-root
   * containment outranks perfect TypeScript emulation, and a config that silently
   * came from somewhere else is the thing a consumer most needs to know.
   */
  readonly unusableConfigs: readonly { readonly source: string; readonly reason: string }[];
}

/** A discovered package directory. */
export interface PackageRoot {
  /** Repository-relative directory; `.` for the root. */
  readonly path: string;
}

/** Collects the observations the selector makes as it goes. */
interface SelectionNotes {
  readonly tsconfigs: string[];
  readonly unsupportedPatterns: { source: string; pattern: string }[];
  readonly unusableConfigs: { source: string; reason: string }[];
}

/**
 * Selects the source universe for every discovered package.
 *
 * Packages are visited deepest-root-first and their file lists merged, so the
 * result never depends on which package was examined first. Files are
 * deduplicated by path: a root `tsconfig.json` and a package's own may both
 * select the same file, and one file is one module node.
 */
export async function selectSourceUniverse(
  context: DiscoveryProbeContext,
  packageRoots: readonly PackageRoot[],
): Promise<SourceUniverseResult> {
  const notes: SelectionNotes = {
    tsconfigs: [],
    unsupportedPatterns: [],
    unusableConfigs: [],
  };
  const budget = new EntryBudget(MAX_SOURCE_ENTRIES);
  const selected = new Map<string, SourceFile>();
  const resolvable = new Set<string>();
  const resolutions = new Map<string, PackageResolution>();
  let truncated = false;
  let truncatedBy: string | null = null;
  let usedTsconfig = false;
  let usedTraversal = false;

  for (const root of [...packageRoots].sort(byDepthDescending)) {
    const config = await loadPackageConfig(context, root.path, notes);
    const packageFiles =
      config === undefined
        ? await walkPackage(context, root.path, budget)
        : await walkWithConfig(context, root.path, config, notes);
    if (config === undefined) {
      usedTraversal = true;
      resolutions.set(root.path, fallbackResolution());
    } else {
      usedTsconfig = true;
      resolutions.set(root.path, config.resolution);
      for (const candidate of config.candidates) {
        resolvable.add(candidate);
      }
    }

    for (const candidate of packageFiles) {
      if (!isSupportedSourcePath(candidate)) {
        // A declaration file or a JSON document is a legitimate import *target*
        // but is not itself a module node, so it joins the resolvable set and
        // not the universe.
        resolvable.add(candidate);
        continue;
      }
      if (selected.size >= MAX_SOURCE_FILES) {
        truncated = true;
        truncatedBy ??= `MAX_SOURCE_FILES (${String(MAX_SOURCE_FILES)})`;
        break;
      }
      if (selected.has(candidate)) {
        continue;
      }
      selected.set(candidate, { path: candidate, packagePath: root.path });
    }
    if (truncated) {
      break;
    }
  }

  if (budget.exhausted && !truncated) {
    truncated = true;
    truncatedBy ??= `MAX_SOURCE_ENTRIES (${String(MAX_SOURCE_ENTRIES)})`;
  }

  return {
    files: [...selected.values()].sort((a, b) => compareCodeUnits(a.path, b.path)),
    resolvable,
    tsconfigs: notes.tsconfigs.sort(compareCodeUnits),
    strategy: strategyOf(usedTsconfig, usedTraversal),
    resolutions,
    truncated,
    truncatedBy,
    unsupportedPatterns: notes.unsupportedPatterns.sort(
      (a, b) => compareCodeUnits(a.source, b.source) || compareCodeUnits(a.pattern, b.pattern),
    ),
    unusableConfigs: notes.unusableConfigs.sort((a, b) => compareCodeUnits(a.source, b.source)),
  };
}

function strategyOf(
  usedTsconfig: boolean,
  usedTraversal: boolean,
): "tsconfig" | "bounded-traversal" | "mixed" {
  if (usedTsconfig && usedTraversal) {
    return "mixed";
  }
  return usedTsconfig ? "tsconfig" : "bounded-traversal";
}

/**
 * Deepest package root first, code-unit within one depth.
 *
 * Deterministic and independent of discovery order, which is what stops a
 * truncated walk from surviving a different set of files depending on how the
 * file system happened to enumerate them.
 */
function byDepthDescending(a: PackageRoot, b: PackageRoot): number {
  const depthA = a.path === REPOSITORY_ROOT ? 0 : a.path.split("/").length;
  const depthB = b.path === REPOSITORY_ROOT ? 0 : b.path.split("/").length;
  return depthB - depthA || compareCodeUnits(a.path, b.path);
}

/**
 * The resolution used when a package states none.
 *
 * `Bundler`, published in `sourceUniverse.resolutionMode` as a documented
 * narrowing. It is the more permissive modern mode, so it accepts both
 * extensionless and `.js`-mapped specifiers; a repository whose runtime differs
 * shows unresolved imports, which is the correct direction to fail.
 */
function fallbackResolution(): PackageResolution {
  return {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: undefined,
    paths: undefined,
  };
}

interface LoadedConfig {
  /** Repository-relative files the config's own enumeration selected. */
  readonly candidates: readonly string[];
  /** The config's repository-relative path, for citing an unsupported pattern. */
  readonly source: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly resolution: PackageResolution;
}

/**
 * Parses a package's `tsconfig.json` over a repository-fenced host.
 *
 * Returns undefined when there is no config, or when TypeScript rejects it, so
 * the caller can fall back to traversal and publish why. Every host method is
 * fenced: nothing outside the repository root is readable and `node_modules` is
 * invisible, so an `extends` into an installed package is refused rather than
 * followed. No config is ever *executed* — it is read as text and parsed.
 */
async function loadPackageConfig(
  context: DiscoveryProbeContext,
  packagePath: string,
  notes: SelectionNotes,
): Promise<LoadedConfig | undefined> {
  const relative =
    packagePath === REPOSITORY_ROOT ? TSCONFIG_FILENAME : `${packagePath}/${TSCONFIG_FILENAME}`;
  const read = await safeRead(context, relative);
  if (read.status === "absent") {
    return undefined;
  }
  if (read.status === "failed") {
    notes.unusableConfigs.push({
      source: relative,
      reason: "The file exists but could not be read, so it was not parsed.",
    });
    return undefined;
  }

  const parsed = ts.parseConfigFileTextToJson(relative, read.content);
  if (parsed.error !== undefined) {
    notes.unusableConfigs.push({
      source: relative,
      reason: "The file is not parseable as JSON, so it was not used.",
    });
    return undefined;
  }

  // `readDirectory` returns nothing: TypeScript's own enumeration is a
  // synchronous whole-tree walk, and this run's walk is bounded and
  // asynchronous. The config is still parsed here — which is what resolves
  // `extends`, `compilerOptions`, `moduleResolution`, `paths`, and `baseUrl`,
  // the parts that are genuinely TypeScript's semantics — and its resolved
  // `files`/`include`/`exclude` are applied by the walk below.
  //
  // The `extends` chain is collected asynchronously first and served from a
  // fixed map, because `ParseConfigHost.readFile` is synchronous and the
  // repository's file system is not. A chain target outside the repository is
  // simply absent from the map, so TypeScript reports it as unresolved and the
  // config is published as unusable — which is the fence working, not a bug.
  const chain = await collectExtendsChain(context, relative, read.content);
  const result = ts.parseJsonConfigFileContent(
    parsed.config,
    {
      useCaseSensitiveFileNames: true,
      getCurrentDirectory: () => context.repoRoot,
      fileExists: (absolute) => chain.has(absolute.replace(/\\/g, "/")),
      readFile: (absolute) => chain.get(absolute.replace(/\\/g, "/")),
      readDirectory: () => [],
    },
    joinPath(context.repoRoot, packagePath),
    undefined,
    joinPath(context.repoRoot, relative),
  );
  if (hasSubstantiveConfigError(result.errors)) {
    notes.unusableConfigs.push({
      source: relative,
      reason: describeConfigErrors(result.errors),
    });
    return undefined;
  }

  notes.tsconfigs.push(relative);
  const include = includeSpecsOf(parsed.config);
  const exclude = excludeSpecsOf(
    parsed.config,
    repositoryRelativeOutDir(context.repoRoot, result.options.outDir),
  );
  return {
    candidates: result.fileNames
      .map((absolute) => toRepositoryRelative(context.repoRoot, absolute))
      .filter((path): path is string => path !== undefined),
    source: relative,
    include,
    exclude,
    resolution: {
      moduleResolution: result.options.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
      baseUrl: result.options.baseUrl,
      paths: result.options.paths,
    },
  };
}

/** How many `extends` hops a config chain may take before the walk stops. */
const MAX_EXTENDS_DEPTH = 8;

/**
 * Reads a config's `extends` chain into an absolute-path → text map.
 *
 * Repository-relative and package-relative targets are handled, and a
 * `node_modules` target is **not**: an installed config is outside this
 * repository's own declaration surface, and reading it would make the graph's
 * file universe depend on what happened to be installed. The chain terminates
 * on a cycle, on an unreadable file, or at the depth bound, and every termination
 * is a fence rather than a failure — TypeScript then reports the unresolved
 * reference and the config is published as unusable.
 */
async function collectExtendsChain(
  context: DiscoveryProbeContext,
  configPath: string,
  configText: string,
): Promise<Map<string, string>> {
  const chain = new Map<string, string>();
  const own = joinPath(context.repoRoot, configPath);
  chain.set(own.replace(/\\/g, "/"), configText);

  let currentPath = configPath;
  let currentText = configText;
  for (let depth = 0; depth < MAX_EXTENDS_DEPTH; depth++) {
    const targets = extendsTargetsOf(currentText);
    if (targets.length === 0) {
      break;
    }
    const next = targets[0];
    if (next === undefined) {
      break;
    }
    const resolved = resolveExtendsTarget(context, currentPath, next);
    if (resolved === undefined) {
      break;
    }
    const absolute = joinPath(context.repoRoot, resolved).replace(/\\/g, "/");
    if (chain.has(absolute)) {
      break;
    }
    const read = await safeRead(context, resolved);
    if (read.status !== "read") {
      break;
    }
    chain.set(absolute, read.content);
    currentPath = resolved;
    currentText = read.content;
  }
  return chain;
}

/** The `extends` targets a config declares, in its own order. */
function extendsTargetsOf(text: string): string[] {
  const parsed = ts.parseConfigFileTextToJson(TSCONFIG_FILENAME, text);
  const value = asRecord(parsed.config)["extends"];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? [value] : [];
}

/**
 * A repository-relative path for an `extends` target, or undefined.
 *
 * `undefined` covers every form this version refuses: an absolute path, a `..`
 * escape out of the repository, a bare package specifier that would only resolve
 * through `node_modules`, and an empty string. None of them is an error to
 * report separately — the chain simply stops, and TypeScript reports the
 * unresolved reference, which is the honest statement.
 */
function resolveExtendsTarget(
  context: DiscoveryProbeContext,
  fromConfigPath: string,
  target: string,
): string | undefined {
  if (target.length === 0 || target.startsWith("/") || /^[A-Za-z]:/.test(target)) {
    return undefined;
  }
  if (NEVER_TRAVERSED_DIRECTORIES.includes(target)) {
    return undefined;
  }
  const fromDirectory = fromConfigPath.includes("/")
    ? fromConfigPath.slice(0, fromConfigPath.lastIndexOf("/"))
    : REPOSITORY_ROOT;
  const segments = fromDirectory === REPOSITORY_ROOT ? [] : fromDirectory.split("/");
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        // An escape out of the repository root. Refused rather than clamped:
        // clamping would read a different file than the config named.
        return undefined;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const candidate = withConfigExtension(segments.join("/"));
  if (
    candidate === undefined ||
    !isReadableInsideRepository(context, joinPath(context.repoRoot, candidate))
  ) {
    return undefined;
  }
  return isRepositoryRelativePath(candidate) ? candidate : undefined;
}

/** Appends `.json` when a config target names no extension, as TypeScript does. */
function withConfigExtension(path: string): string | undefined {
  if (path.length === 0) {
    return undefined;
  }
  return path.endsWith(".json") ? path : `${path}.json`;
}

/**
 * TypeScript diagnostic codes that are about *enumeration* rather than about
 * whether the configuration is usable.
 *
 * `18002` (an empty `files` list) and `18003` (an `include` that matched
 * nothing) are both consequences of this run's host answering `readDirectory`
 * with an empty list — the enumeration is done by the bounded walk below, not
 * by TypeScript. Treating them as a broken configuration would reject every
 * `tsconfig.json` in the repository, which is the sort of confident wrong
 * answer this whole record exists to avoid. A genuinely empty `include` is
 * reported as zero modules rather than as a rejected config.
 */
const ENUMERATION_DIAGNOSTIC_CODES: readonly number[] = [18002, 18003];

/** True when a config has a problem beyond the enumeration artefacts. */
function hasSubstantiveConfigError(errors: readonly ts.Diagnostic[]): boolean {
  return errors.some((error) => !ENUMERATION_DIAGNOSTIC_CODES.includes(error.code));
}

/** The real problems a config has, phrased for a reader who can act on them. */
function describeConfigErrors(errors: readonly ts.Diagnostic[]): string {
  const texts = errors
    .filter((error) => !ENUMERATION_DIAGNOSTIC_CODES.includes(error.code))
    .map((error) => ts.flattenDiagnosticMessageText(error.messageText, " "));
  return `${texts.join(" ")} Its include and exclude settings were therefore not applied, and this package's source universe came from the bounded traversal instead.`;
}

/**
 * The `files` list plus the `include` globs, in TypeScript's own precedence.
 *
 * With neither stated, TypeScript includes everything under the config
 * directory. That default is reproduced here rather than left to a walk that
 * would otherwise have no inclusion rule at all.
 */
function includeSpecsOf(config: unknown): string[] {
  const source = asRecord(config);
  const files = stringArray(source["files"]);
  const include = stringArray(source["include"]);
  if (files.length === 0 && include.length === 0) {
    return ["**/*"];
  }
  return [...files, ...include];
} /** The `exclude` globs, with TypeScript's defaults and `outDir` filled in. */
function excludeSpecsOf(config: unknown, outDir: string | undefined): string[] {
  const declared = stringArray(asRecord(config)["exclude"]);
  const out = outDir === undefined ? [] : [outDir];
  return [...declared, ...TYPESCRIPT_DEFAULT_EXCLUDES, ...out].filter(
    (pattern) => pattern.length > 0,
  );
}

/**
 * `outDir` as a repository-relative path, or null.
 *
 * TypeScript resolves `outDir` to an absolute path because the config was
 * parsed against an absolute base — and an absolute exclude pattern matches
 * nothing here, would be rejected as an absolute glob, and would put a machine's
 * home directory into a diagnostic. Converting it back is therefore not
 * cosmetic: without it a build output directory is neither excluded nor
 * reported, and a repository with a real `outDir` gets its compiled JavaScript
 * analysed as source.
 */
function repositoryRelativeOutDir(
  repoRoot: string,
  outDir: string | undefined,
): string | undefined {
  if (outDir === undefined) {
    return undefined;
  }
  const relative = toRepositoryRelative(repoRoot, outDir);
  if (relative === undefined || relative === REPOSITORY_ROOT) {
    return undefined;
  }
  return relative.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * The bounded walk that applies a config's include and exclude lists.
 *
 * A pattern matches a file when it matches the file or any of its ancestor
 * directories, which is what makes `include: ["src"]` mean "the `src` directory
 * and everything in it" and `exclude: ["dist"]` mean the same. Sorted at every
 * level, symbolic links never followed, and `node_modules` and `.git` refused
 * entry regardless of what a config says — those two are never part of a
 * repository's own source model, and entering them would make the graph depend
 * on install state.
 *
 * A directory is pruned **only** by an exclude. It is not pruned by failing to
 * match an include, because `include: ["src/**\/*.ts"]` names files under
 * `src` rather than the directory `src` itself: a walk that required a
 * directory to match an include would never descend into `src` at all and would
 * report a repository with a perfectly good `tsconfig.json` as having no
 * sources. The entry and depth bounds are what keep the cost of a wider walk
 * predictable, and hitting one is reported rather than hidden.
 */
async function walkWithConfig(
  context: DiscoveryProbeContext,
  packagePath: string,
  config: LoadedConfig,
  notes: SelectionNotes,
): Promise<string[]> {
  const budget = new EntryBudget(MAX_SOURCE_ENTRIES);
  const include = splitUsable(config.include, config, notes);
  const exclude = splitUsable(config.exclude, config, notes);
  return walkDirectory(context, packagePath, budget, (child, isDirectory) => {
    if (exclude.some((pattern) => matchesGlobPattern(child, pattern))) {
      return false;
    }
    if (isDirectory) {
      return true;
    }
    if (
      exclude.some(
        (pattern) => matchesGlobPattern(child, pattern) || hasAncestorMatch(child, [pattern]),
      )
    ) {
      return false;
    }
    return (
      include.length === 0 ||
      include.some(
        (pattern) => matchesGlobPattern(child, pattern) || hasAncestorMatch(child, [pattern]),
      )
    );
  });
}

/**
 * Splits a declared pattern list into the supported subset and the rest.
 *
 * The unsupported half is reported rather than applied, so a config using an
 * extglob produces a published `unsupportedPatterns` entry instead of a universe
 * that quietly differs from what the compiler would have seen.
 */
function splitUsable(
  patterns: readonly string[],
  config: LoadedConfig,
  notes: SelectionNotes,
): string[] {
  const usable: string[] = [];
  for (const raw of patterns) {
    const pattern = raw.startsWith("./") ? raw.slice(2) : raw;
    if (isSupportedGlobSubset(pattern)) {
      usable.push(pattern);
    } else {
      notes.unsupportedPatterns.push({ source: config.source, pattern: raw });
    }
  }
  return usable;
}

/** True when `path` or one of its ancestor directories matches `patterns`. */
function hasAncestorMatch(path: string, patterns: readonly string[]): boolean {
  let current = path;
  for (;;) {
    if (patterns.some((pattern) => matchesGlobPattern(current, pattern))) {
      return true;
    }
    if (current === REPOSITORY_ROOT) {
      return false;
    }
    const separator = current.lastIndexOf("/");
    if (separator < 0) {
      return false;
    }
    current = current.slice(0, separator);
  }
}

/**
 * Whether a declared pattern is inside ADR-0005's published subset.
 *
 * The subset is `*`, `**`, `?`, `[...]`, `{a,b}`. A backslash escape or an
 * extglob is outside it, and a pattern this code cannot evaluate must not be
 * presented as one it did.
 */
function isSupportedGlobSubset(pattern: string): boolean {
  if (pattern.includes("\\")) {
    return false;
  }
  if (/[(]/.test(pattern.replace(/\{[^}]*\}/g, "").replace(/\[[^\]]*\]/g, ""))) {
    return false;
  }
  return "normalized" in normalizePathPattern(pattern, "include", { allowGlob: true });
}

/**
 * The bounded fallback walk for a package with no usable `tsconfig.json`.
 *
 * Blind on purpose: only `node_modules` and `.git` are refused. `dist`, `build`,
 * `out`, and `coverage` are *not* silently skipped, because a build output
 * directory is genuinely ambiguous and guessing is what this project refuses to
 * do. A repository that wants a precise universe can write four lines of
 * `tsconfig.json` and get one.
 */
async function walkPackage(
  context: DiscoveryProbeContext,
  packagePath: string,
  budget: EntryBudget,
): Promise<string[]> {
  return walkDirectory(context, packagePath, budget, () => true);
}

/**
 * One bounded, deterministic directory walk.
 *
 * Shared by both strategies so the traversal rules — order, depth, links,
 * fencing, and the entry budget — are implemented exactly once. `accepts` is the
 * only thing that differs between them, which is what keeps "the fallback
 * excludes nothing" and "a config excludes what it declares" from drifting apart
 * in the details that make a walk safe.
 */
async function walkDirectory(
  context: DiscoveryProbeContext,
  packagePath: string,
  budget: EntryBudget,
  accepts: (relativePath: string, isDirectory: boolean) => boolean,
): Promise<string[]> {
  const found: string[] = [];
  const visited = new Set<string>();
  const queue: { relative: string; level: number }[] = [{ relative: packagePath, level: 0 }];
  while (queue.length > 0) {
    if (budget.exhausted) {
      break;
    }
    const current = queue.shift();
    if (current === undefined || current.level > MAX_SOURCE_DEPTH) {
      continue;
    }
    const listing = await safeList(context, current.relative);
    if (listing.status !== "listed") {
      continue;
    }
    for (const entry of listing.entries) {
      if (!budget.spendOne()) {
        break;
      }
      if (NEVER_TRAVERSED_DIRECTORIES.includes(entry.name)) {
        continue;
      }
      if (entry.isSymbolicLink) {
        // A link inside the repository is never a path out of it, and never a
        // second name for a file the walk already holds.
        continue;
      }
      const child =
        current.relative === REPOSITORY_ROOT ? entry.name : `${current.relative}/${entry.name}`;
      if (!isRepositoryRelativePath(child) || visited.has(child)) {
        continue;
      }
      if (entry.isDirectory) {
        if (accepts(child, true)) {
          queue.push({ relative: child, level: current.level + 1 });
        }
        continue;
      }
      if (!entry.isFile || !accepts(child, false)) {
        continue;
      }
      visited.add(child);
      found.push(child);
    }
  }
  return found.sort(compareCodeUnits);
}

/**
 * A shared entry budget across every package's walk.
 *
 * Shared on purpose: a budget per package would make the real ceiling the
 * product of the constant and the number of discovered packages, which is a
 * number the repository controls — the opposite of a constant.
 */
class EntryBudget {
  private remaining: number;

  constructor(total: number) {
    this.remaining = total;
  }

  spendOne(): boolean {
    this.remaining -= 1;
    return this.remaining > 0;
  }

  get exhausted(): boolean {
    return this.remaining <= 0;
  }
}

function isReadableInsideRepository(context: DiscoveryProbeContext, absolute: string): boolean {
  const relative = toRepositoryRelative(context.repoRoot, absolute);
  if (relative === undefined) {
    return false;
  }
  // `node_modules` is invisible for the same reason it is invisible to the module
  // resolver: a graph that changed when someone ran an install would be
  // describing a machine, not a repository.
  return !NEVER_TRAVERSED_DIRECTORIES.some(
    (excluded) => relative === excluded || relative.startsWith(`${excluded}/`),
  );
}

/**
 * The repository-relative form of an absolute path inside the root, or undefined.
 *
 * The containment check is what fences every host: a path that is not literally
 * under the resolved root never becomes a relative path, so it cannot be read,
 * indexed, or cited.
 */
export function toRepositoryRelative(repoRoot: string, absolute: string): string | undefined {
  const root = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalized = absolute.replace(/\\/g, "/");
  if (normalized === root) {
    return REPOSITORY_ROOT;
  }
  if (!normalized.startsWith(`${root}/`)) {
    return undefined;
  }
  const relative = normalized.slice(root.length + 1);
  return isRepositoryRelativePath(relative) ? relative : undefined;
}

/** True when a repository-relative path is a source file this version analyses. */
export function isSupportedSourcePath(path: string): boolean {
  return SUPPORTED_SOURCE_EXTENSIONS.includes(sourceExtensionOf(path));
}
