/**
 * Resolving one import specifier (ADR-0047 §12).
 *
 * Resolution uses `ts.resolveModuleName` behind a `ts.ModuleResolutionHost`
 * whose every method is a repository-fenced repository read. That is the whole
 * point of using TypeScript here: this repository's own `moduleResolution` is
 * `NodeNext`, so `import "./x.js"` legitimately denotes `x.ts`, and a
 * hand-rolled resolver that missed that would report Agent-Ready's own imports
 * as unresolved — the exact "confidently wrong" outcome this project exists to
 * avoid.
 *
 * The host is fenced in four ways, each with a test:
 *
 *  1. Nothing outside the repository root is readable.
 *  2. `node_modules` is invisible, so a resolution can never land in an
 *     installed tree.
 *  3. `directoryExists` is confined to the repository, so a walk upwards cannot
 *     discover an installed package.
 *  4. The resolved absolute path is re-checked for containment before use, so a
 *     resolver quirk cannot leak a target out.
 *
 * Non-relative specifiers never reach the resolver at all. A workspace package is
 * identified from the *discovered manifests* rather than from an installed
 * symlink, which is what makes a workspace import resolve with `node_modules`
 * entirely absent — and what makes the graph independent of install state.
 */

import { builtinModules } from "node:module";
import ts from "typescript";
import { joinPath } from "../../filesystem/pathJoin.js";
import { REPOSITORY_ROOT, isRepositoryRelativePath } from "./provenance.js";
import { toRepositoryRelative } from "./sourceUniverse.js";
import type { PackageResolution } from "./sourceUniverse.js";
import type { UnresolvedReason } from "./types.js";

/**
 * The Node built-in module names, with and without the `node:` prefix.
 *
 * Taken from the runtime's own `module.builtinModules`, which is a fixed
 * enumerable list rather than a heuristic, and deduplicated so `path` and
 * `node:path` are one entry. A built-in is a `platform` resolution with no
 * target node: the runtime provides it, and no file in this repository declares
 * it, so a node for it would put something in the graph that no repository file
 * created.
 *
 * **The list is supplemented, because the runtime's own is incomplete.**
 * `builtinModules` omits modules that are nonetheless documented and available —
 * `node:test` most importantly, whose absence means `import … from
 * "node:test/reporters"` would be classified as an external dependency and mint
 * a node for a thing no `package.json` declares. The supplement is a short,
 * explicit list rather than a rule, because a rule ("anything unresolvable is a
 * built-in") would be a guess dressed as a classification, and this module
 * guesses about nothing.
 */
const SUPPLEMENTARY_BUILTINS: readonly string[] = [
  "test",
  "sqlite",
  "sea",
  "quic",
  "test/reporters",
  "sqlite/worker",
];

const BUILTIN_NAMES: ReadonlySet<string> = (() => {
  const names = new Set<string>();
  for (const name of [...builtinModules, ...SUPPLEMENTARY_BUILTINS]) {
    names.add(name);
    names.add(name.startsWith("node:") ? name.slice("node:".length) : `node:${name}`);
  }
  return names;
})();

/** True when a specifier names something the Node runtime provides. */
export function isNodeBuiltIn(specifier: string): boolean {
  if (BUILTIN_NAMES.has(specifier)) {
    return true;
  }
  // `node:test/reporters` and `assert/strict` are subpath forms of a built-in,
  // so the head segment decides. Only the *first* segment: a two-segment
  // supplement entry such as `sqlite/worker` is matched whole above, because
  // stripping its head would ask whether `sqlite/worker` names a built-in and
  // then quietly answer about a different module.
  const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  const head = bare.includes("/") ? bare.slice(0, bare.indexOf("/")) : bare;
  return head.length > 0 && BUILTIN_NAMES.has(head);
}

/**
 * A workspace package name mapped to its canonical package directory.
 *
 * Built from ADR-0045's discovered packages, so a workspace import is resolved
 * from a repository declaration rather than from whatever is installed. A
 * duplicate name is resolved to the code-unit-first path: two packages
 * declaring the same name is a repository inconsistency, and picking by
 * discovery order would make the answer depend on the walk.
 */
export type WorkspaceNames = ReadonlyMap<string, string>;

/** What the resolver needs to know beyond the repository itself. */
export interface ResolutionContext {
  readonly repoRoot: string;
  /** Every file a resolution may land on, repository-relative. */
  readonly resolvable: ReadonlySet<string>;
  /** Discovered workspace package names → canonical package directory. */
  readonly workspaceNames: WorkspaceNames;
  /** Per-package resolution settings from the package's own config. */
  readonly resolutions: ReadonlyMap<string, PackageResolution>;
}

/** The outcome of resolving one specifier, before it becomes an edge. */
export type ResolvedTarget =
  | { readonly kind: "module"; readonly path: string }
  | { readonly kind: "package"; readonly packagePath: string; readonly subpath: string | null }
  | { readonly kind: "dependency"; readonly name: string }
  | { readonly kind: "platform" }
  | { readonly kind: "unresolved"; readonly reason: UnresolvedReason };

/**
 * Resolves one specifier as written in `fromPath`.
 *
 * The order of the checks is the order of what can be *known*:
 *
 *  1. A built-in is a platform answer — certain, and from no repository file.
 *  2. A specifier whose shape is not a module specifier at all is
 *     `unsupported-specifier`. A URL, a Windows absolute path, and a bare `/x`
 *     are all things a `.d.ts` or a bundler config might produce, and none of
 *     them can be resolved without semantics this version does not model.
 *  3. A relative specifier goes to the resolver, fenced.
 *  4. Anything else is a package name, and a workspace package is identified
 *     from the discovered manifests before an external one is assumed.
 */
export function resolveSpecifier(
  specifier: string,
  fromPath: string,
  packagePath: string,
  context: ResolutionContext,
): ResolvedTarget {
  if (specifier.length === 0) {
    return { kind: "unresolved", reason: "unsupported-specifier" };
  }
  if (isNodeBuiltIn(specifier)) {
    return { kind: "platform" };
  }
  if (isUnsupportedSpecifierShape(specifier)) {
    return { kind: "unresolved", reason: "unsupported-specifier" };
  }

  if (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier === "." ||
    specifier === ".."
  ) {
    return resolveRelative(specifier, fromPath, packagePath, context);
  }

  const packageName = barePackageNameOf(specifier);
  if (packageName === undefined) {
    return { kind: "unresolved", reason: "unsupported-specifier" };
  }
  const workspacePath = context.workspaceNames.get(packageName);
  if (workspacePath !== undefined) {
    const subpath = specifier === packageName ? null : specifier.slice(packageName.length);
    // The package is known; the module inside it is not, and no subpath is ever
    // mapped to a guessed file path. A consumer can read "package known, module
    // unresolved" as exactly that, and the `package` resolution variant is the
    // honest intermediate until `exports` resolution is deliberately supported.
    return { kind: "package", packagePath: workspacePath, subpath };
  }
  return { kind: "dependency", name: packageName };
}

/**
 * Specifier shapes that cannot be a module specifier in any supported universe.
 *
 * A URL, a `data:` URI, a protocol-relative URL, a POSIX-absolute path, and a
 * Windows drive path are all real things that appear in `.d.ts` files and in
 * bundler-oriented code. None is an npm package name, and treating one as a
 * package name would mint a dependency node for something no manifest declares.
 */
function isUnsupportedSpecifierShape(specifier: string): boolean {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier)) {
    return true;
  }
  if (specifier.startsWith("//")) {
    return true;
  }
  if (specifier.startsWith("/")) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(specifier) || /^[A-Za-z]:$/.test(specifier)) {
    return true;
  }
  return false;
}

/**
 * The package name inside a bare specifier, at the **scope boundary**.
 *
 * `@scope/pkg/subpath` is the package `@scope/pkg`; `lodash/fp` is `lodash`.
 * Splitting at the first `/` would turn `@scope/pkg` into `@scope` — a package
 * name that cannot exist — which is the same class of bug #38 already found in
 * manager-name parsing. A leading `@` means the name runs to the *second*
 * separator, and that rule is the whole function.
 */
export function barePackageNameOf(specifier: string): string | undefined {
  if (specifier.length === 0 || specifier.startsWith(".") || specifier.startsWith("/")) {
    return undefined;
  }
  if (specifier.startsWith("@")) {
    const firstSlash = specifier.indexOf("/");
    if (firstSlash < 0) {
      // `@scope` with no package after it is not a valid package name; there is
      // nothing here to be one, so no name is minted.
      return undefined;
    }
    const secondSlash = specifier.indexOf("/", firstSlash + 1);
    const name = secondSlash < 0 ? specifier : specifier.slice(0, secondSlash);
    return name.length > "@".length + 1 ? name : undefined;
  }
  const firstSlash = specifier.indexOf("/");
  const name = firstSlash < 0 ? specifier : specifier.slice(0, firstSlash);
  return name.length > 0 ? name : undefined;
}

/**
 * Resolves a relative specifier against a repository file.
 *
 * The resolver is handed a host that can only see the files discovery already
 * enumerated, so a resolution that "succeeds" has succeeded against real
 * repository content and not against an installed tree or a machine-global
 * cache.
 */
function resolveRelative(
  specifier: string,
  fromPath: string,
  packagePath: string,
  context: ResolutionContext,
): ResolvedTarget {
  const containing = ts.resolveModuleName(
    specifier,
    joinPath(context.repoRoot, fromPath),
    compilerOptionsFor(packagePath, context),
    createResolutionHost(context),
  );
  const resolved = containing.resolvedModule;
  if (resolved === undefined) {
    return { kind: "unresolved", reason: "target-not-found" };
  }
  const relative = toRepositoryRelative(context.repoRoot, resolved.resolvedFileName);
  if (relative === undefined) {
    // The resolver produced something outside the root. The fence says the
    // answer is "outside-repository", not the path it found: publishing a path
    // this run refuses to read would leak a location into the snapshot.
    return { kind: "unresolved", reason: "outside-repository" };
  }
  if (!isRepositoryRelativePath(relative)) {
    return { kind: "unresolved", reason: "outside-repository" };
  }
  return { kind: "module", path: relative };
}

/** The compiler options one package's imports are resolved under. */
function compilerOptionsFor(packagePath: string, context: ResolutionContext): ts.CompilerOptions {
  const resolution = context.resolutions.get(packagePath);
  if (resolution === undefined) {
    return { moduleResolution: ts.ModuleResolutionKind.Bundler };
  }
  return {
    moduleResolution: resolution.moduleResolution,
    ...(resolution.baseUrl === undefined
      ? {}
      : { baseUrl: toAbsolute(context.repoRoot, resolution.baseUrl) }),
    ...(resolution.paths === undefined ? {} : { paths: resolution.paths }),
  };
}

/**
 * The `ModuleResolutionHost` every resolution runs against.
 *
 * Fenced, and carrying no clock, no environment, and no global state, so two
 * runs of the same tree resolve identically and a resolution can never escape
 * the repository or reach into an installed tree.
 */
export function createResolutionHost(context: ResolutionContext): ts.ModuleResolutionHost {
  return {
    fileExists: (absolute) => {
      const relative = visibleRelative(context, absolute);
      return relative !== undefined && context.resolvable.has(relative);
    },
    readFile: () => undefined,
    directoryExists: (absolute) => directoryExists(context, absolute),
    realpath: (absolute) => absolute,
    // `readFile` is deliberately inert. The resolver only needs to know *that*
    // a file exists to pick it; giving it contents would let a resolution
    // depend on a package's `package.json` text, which is precisely the
    // install-state coupling the fence exists to remove.
    getCurrentDirectory: () => context.repoRoot,
  };
}

/** The repository-relative form of a path the host is willing to see at all. */
function visibleRelative(context: ResolutionContext, absolute: string): string | undefined {
  const relative = toRepositoryRelative(context.repoRoot, absolute);
  if (relative === undefined) {
    return undefined;
  }
  if (relative === REPOSITORY_ROOT) {
    return relative;
  }
  const firstSegment = relative.includes("/") ? relative.slice(0, relative.indexOf("/")) : relative;
  if (firstSegment === "node_modules" || firstSegment === ".git") {
    // Invisibility, not "not found": an installed tree is not part of this
    // repository's declared structure, and letting the resolver probe it is
    // exactly what would make the graph depend on install state.
    return undefined;
  }
  return relative;
}

/**
 * Whether a directory exists, as far as the enumerated repository says.
 *
 * Derived from the resolvable set rather than from the file system, because the
 * host is synchronous and the file system is not. A directory "exists" when a
 * file inside it does, which is the only question the resolver asks it.
 */
function directoryExists(context: ResolutionContext, absolute: string): boolean {
  const relative = visibleRelative(context, absolute);
  if (relative === undefined) {
    return false;
  }
  const prefix = relative === REPOSITORY_ROOT ? "" : `${relative}/`;
  for (const candidate of context.resolvable) {
    if (candidate.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/** Resolves a config's `baseUrl`, which TypeScript reports as an absolute path. */
function toAbsolute(repoRoot: string, baseUrl: string): string {
  return baseUrl.includes(":") || baseUrl.startsWith("/") ? baseUrl : joinPath(repoRoot, baseUrl);
}
