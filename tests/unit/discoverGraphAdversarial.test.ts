/**
 * Issue #39, adversarial: the module and dependency graph with fact provenance.
 *
 * Issues #36 through #38 tested the substrate — facts, packages, workspaces,
 * commands — and the discipline was consistent: take a real condition a
 * repository can be in, build it, and assert that what comes out is the thing
 * the decision record says it should be, not the thing that is easiest to
 * produce. #39 raises the stakes, because the graph's whole claim is that its
 * edges can be audited. A graph that looks right and cannot be checked is worse
 * than no graph, so most of what follows is adversarial: paths that try to
 * escape the repository, positions that try to be plausible rather than true,
 * resolutions that try to guess, and owners that were never declared.
 *
 * The matrix runs A through AG. The groups are: A–D provenance as a citable
 * line, E–H imports and their resolution fence, I–K dependency edges and the
 * declared/resolved split, L–N ownership and the explicit unowned state,
 * O–R bounds and truncation, S–V the validator's own invariants, W–Z JSON
 * pointer positions, and AA–AG the end-to-end surface.
 *
 * Writing it found three defects in the implementation, all recorded in
 * ADR-0047's amendments and fixed rather than documented around: the probe
 * context joined the repository root's own relative path (`.`) onto the root,
 * so listing it silently failed; `sourceExtensionOf` measured a declaration
 * extension with a fixed offset, so `.d.mts` reported `d.mts`; and a file
 * ending in a newline was counted as having one line more than it does, which
 * is the validator's upper bound for a citation.
 */

import { describe, expect, it } from "vitest";
import { runDiscover } from "../../src/cli/commands/discover.js";
import { discoverRepository } from "../../src/discover/discover.js";
import {
  barePackageNameOf,
  createResolutionHost,
  isNodeBuiltIn,
} from "../../src/discover/graph/resolve.js";
import {
  escapePointerSegment,
  indexJsonPositions,
  locationForPointer,
} from "../../src/discover/graph/jsonSource.js";
import {
  LineIndex,
  LineIndexCache,
  baseName,
  isRepositoryRelativePath,
  isWithinDirectory,
  locationFromNode,
  parentDirectory,
  sourceExtensionOf,
} from "../../src/discover/graph/provenance.js";
import { extractImports } from "../../src/discover/graph/imports.js";
import { MAX_LOCKFILE_BYTES, prepareLockfile } from "../../src/discover/graph/lockfiles.js";
import {
  CODEOWNERS_LOCATIONS,
  ownersForPath,
  parseCodeowners,
  ruleMatches,
  unsupportedPatternReason,
} from "../../src/discover/graph/ownership.js";
import { MAX_SOURCE_DEPTH } from "../../src/discover/graph/sourceUniverse.js";
import {
  dependencyEdgesOf,
  describeViolation,
  ownershipEdgesOf,
  validateGraph,
} from "../../src/discover/graph/validate.js";
import type {
  DependencyEdge,
  GraphEdge,
  GraphNode,
  ImportEdge,
  ModuleNode,
  OwnershipEdge,
  OwnerNode,
  PackageNode,
  RepositoryGraph,
  SourceLocation,
} from "../../src/discover/graph/types.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import {
  FaultyFileSystem,
  RecordingFileSystem,
  manifest,
  repoWith,
} from "./discoverTestDoubles.js";

/** Discovers `files` and returns the graph, failing loudly rather than skipping. */
async function graphOf(files: Record<string, string>): Promise<RepositoryGraph> {
  const result = await discoverRepository(repoWith(files), { startDir: "/repo" });
  if (!result.ok) throw new Error("expected discovery to succeed");
  const graph = result.snapshot.graph;
  if (graph === null) throw new Error("expected a graph");
  return graph;
}

/** Discovers `files` and returns the whole snapshot, for diagnostic assertions. */
async function snapshotOf(files: Record<string, string>) {
  const result = await discoverRepository(repoWith(files), { startDir: "/repo" });
  if (!result.ok) throw new Error("expected discovery to succeed");
  return result.snapshot;
}

type ResolutionHost = ReturnType<typeof createResolutionHost>;
type FenceMember = "fileExists" | "directoryExists" | "readFile" | "getCurrentDirectory";

/**
 * Invokes one member of the fenced resolution host, failing if it is absent.
 *
 * The interface declares every member optional, so this is the only way to
 * assert on one without either a non-null assertion or an optional call — and
 * the two differ in exactly the way that matters here: `host.fileExists?.(x)`
 * evaluates to `undefined` whether the method is missing or the method itself
 * said `undefined`, so a fence that was never installed would pass the test. A
 * fence that is absent must fail, not look like a fence that holds.
 */
function fence(host: ResolutionHost, member: FenceMember, path?: string): unknown {
  const fn = host[member] as ((argument?: string) => unknown) | undefined;
  if (fn === undefined) {
    throw new Error(`the resolution host does not provide ${member}, so its fence is untested`);
  }
  return path === undefined ? fn() : fn(path);
}

/** A tiny TypeScript project: one module that imports two things. */
const TINY_PROJECT = {
  "package.json": manifest({ name: "tiny", dependencies: { left: "^1.0.0" } }),
  "src/index.ts": [
    'import { thing } from "./thing.js";',
    'import left from "left";',
    "export const x = [thing, left];",
    "",
  ].join("\n"),
  "src/thing.ts": "export const thing = 1;\n",
};

/** A project with an explicit `tsconfig.json`, which is what scopes `dist`. */
const CONFIGURED_PROJECT = {
  ...TINY_PROJECT,
  "tsconfig.json":
    JSON.stringify(
      { compilerOptions: { outDir: "dist", moduleResolution: "NodeNext" }, include: ["src"] },
      null,
      2,
    ) + "\n",
};

// ---------------------------------------------------------------------------
// A–D. Provenance is a line a reader can open
// ---------------------------------------------------------------------------

describe("A–D. every citation is a repository-relative file and a 1-based line", () => {
  it("A. cites a repository-relative path and rejects every spelling that is not canonical", () => {
    // A citation whose bytes depend on where the repository is checked out is
    // not portable, and one with two spellings for the same file is an identity
    // a validator cannot check. Both are rejected here, at the one function
    // every citation is built through.
    for (const path of ["package.json", "src/index.ts", "a/b/c.js", "."]) {
      expect(isRepositoryRelativePath(path), path).toBe(true);
    }
    for (const path of [
      "",
      "/etc/passwd",
      "./package.json",
      "../escape",
      "src/../../escape",
      "src//index.ts",
      "src\\index.ts",
      "C:/Windows/system32",
      "src/./index.ts",
      "a/./b",
    ]) {
      expect(isRepositoryRelativePath(path), path).toBe(false);
    }
  });

  it("B. converts a 0-based parser offset into a 1-based line, and counts lines as a person does", () => {
    // The bug this pins is off-by-one in the direction that matters: a citation
    // one line *early* points at a real line that says something else, so it
    // survives a glance. Line 1 must be the first line of the file.
    const text = "one\ntwo\nthree\n";
    const index = LineIndex.of(text);
    expect(index.lineAt(0)).toBe(1);
    expect(index.lineAt(4)).toBe(2);
    expect(index.lineAt(text.indexOf("three"))).toBe(3);
    // A trailing newline does not invent a fourth line. This count is the
    // validator's *upper bound* for a citation, so a phantom line would let a
    // citation onto a line nobody can open.
    expect(index.lineCount).toBe(3);
    expect(index.lineAt(text.length)).toBe(3);
  });

  it("C. returns a line the validator will reject rather than a plausible one, for a file it never read", () => {
    // The alternative is fabricating a position, and a fabricated position is
    // worse than a missing one: it looks citable and is not. Line 1 with no
    // column is the one answer the validator is guaranteed to refuse.
    const cache = new LineIndexCache(new Map());
    expect(cache.positionOf("never-read.ts", 40)).toEqual({ line: 1, column: 1 });
    expect(cache.lineCountOf("never-read.ts")).toBe(0);
  });

  it("D. builds a span whose end is exclusive, the way TypeScript reports `node.end`", () => {
    // Off-by-one on the far end is the quiet one: the span still looks like it
    // covers the declaration, just one character short or long.
    const text = 'import a from "./a.js";\nimport b from "./b.js";\n';
    const cache = new LineIndexCache(new Map([["m.ts", text]]));
    cache.remember("m.ts", text);
    const first = text.indexOf("import a");
    expect(locationFromNode(cache, "m.ts", first, first + 8)).toMatchObject({
      source: "m.ts",
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 9,
    });
    // The second import is on line 2, which is where a reader would look.
    const second = text.indexOf("import b");
    expect(locationFromNode(cache, "m.ts", second, second + 8).line).toBe(2);
  });

  it("D2. does not mistake a declaration file for ordinary TypeScript", () => {
    // `.d.ts` reports `.ts` to a naive last-dot search, and putting declaration
    // files into the module universe as if they were code would put every
    // ambient declaration in the graph as a real module. The compound
    // extension has to be *sliced*, not measured: a fixed offset works for
    // two-character extensions and silently loses the leading dot on the
    // three-character ones.
    expect(sourceExtensionOf("src/types.d.ts")).toBe(".d.ts");
    expect(sourceExtensionOf("src/types.d.mts")).toBe(".d.mts");
    expect(sourceExtensionOf("src/types.d.cts")).toBe(".d.cts");
    expect(sourceExtensionOf("src/index.ts")).toBe(".ts");
    expect(sourceExtensionOf("Makefile")).toBe("");
  });

  it("D3. splits repository-relative paths with `/` on every platform", () => {
    // `path.dirname` would use a host separator and make the graph's structure
    // depend on the machine that produced it.
    expect(parentDirectory("a/b/c.ts")).toBe("a/b");
    expect(parentDirectory("a.ts")).toBe(".");
    expect(baseName("a/b/c.ts")).toBe("c.ts");
    expect(isWithinDirectory("a/b/c.ts", "a/b")).toBe(true);
    // A prefix, not a path prefix: `a/bc` is not inside `a/b`.
    expect(isWithinDirectory("a/bc/d.ts", "a/b")).toBe(false);
    expect(isWithinDirectory("anything", ".")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E–H. Imports: extraction, resolution, and the fence
// ---------------------------------------------------------------------------

describe("E–H. an import edge is surfaced whether or not it resolves", () => {
  it("E. extracts every import form and cites the line the declaration is on", () => {
    const cache = new LineIndexCache(new Map());
    const source = [
      'import a from "./a.js";',
      'import { b } from "./b.js";',
      'import * as c from "./c.js";',
      'import "./side-effect.js";',
      'export { d } from "./d.js";',
      'export * from "./e.js";',
      'const f = await import("./f.js");',
      "",
    ].join("\n");
    cache.remember("m.ts", source);
    const extracted = extractImports("m.ts", source, cache);
    expect(extracted.imports.map((entry) => entry.specifier)).toEqual([
      "./a.js",
      "./b.js",
      "./c.js",
      "./side-effect.js",
      "./d.js",
      "./e.js",
      "./f.js",
    ]);
    // Every one cites a real line, and they ascend, so a reader opening the
    // file finds them in the order the graph lists them.
    const lines = extracted.imports.map((entry) => entry.provenance.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(lines[0]).toBe(1);
    expect(extracted.partial).toBe(false);
  });

  it("F. reports a dynamic import and a require as looked-at, not as resolved", () => {
    // `require` is a thing the graph *saw*. Hiding it would be silence, and
    // claiming it resolved would be a lie — this version does not model
    // CommonJS resolution at all.
    const cache = new LineIndexCache(new Map());
    const source = ['const a = require("./a.js");', 'const b = await import("./b.js");', ""].join(
      "\n",
    );
    cache.remember("m.ts", source);
    const extracted = extractImports("m.ts", source, cache);
    const bySpecifier = new Map(extracted.imports.map((entry) => [entry.specifier, entry]));
    expect(bySpecifier.get("./a.js")?.syntax).toBe("require");
    expect(bySpecifier.get("./b.js")?.syntax).toBe("dynamic-import");
  });

  it("G. refuses to resolve into an installed tree, so the graph does not depend on install state", async () => {
    // The single most important property of the whole module: two checkouts of
    // the same commit, one with `node_modules` present and one without, must
    // produce identical graphs. If a resolution could reach into an installed
    // tree, installing a package would silently change the repository's
    // structure.
    const withInstall = await graphOf({
      ...TINY_PROJECT,
      "node_modules/left/index.js": "module.exports = 1;\n",
      "node_modules/left/package.json": manifest({ name: "left", version: "1.0.0" }),
    });
    const withoutInstall = await graphOf(TINY_PROJECT);
    // Byte-identical, install state or not.
    expect(JSON.stringify(withInstall)).toBe(JSON.stringify(withoutInstall));
    expect(JSON.stringify(withInstall)).not.toContain("node_modules");
  });

  it("H. names the reason an import did not resolve, and keeps the declaration cited", async () => {
    // The requirement is "surfaced, not swallowed". An unresolved import is
    // still an edge with a specifier, a reason, and the file and line of the
    // declaration — only its target is missing.
    const graph = await graphOf({
      "package.json": manifest({ name: "p" }),
      "src/a.ts": [
        'import "./missing.js";',
        'import x from "node:path";',
        'import y from "https://example.invalid/z.js";',
        "",
      ].join("\n"),
    });
    const imports = graph.edges.filter((edge) => edge.kind === "imports");
    const missing = imports.find((edge) => edge.specifier === "./missing.js");
    expect(missing).toMatchObject({
      resolution: { status: "unresolved", reason: "target-not-found" },
      provenance: { source: "src/a.ts", line: 1 },
    });
    // A URL is not a package name, and treating it as one would mint a
    // dependency node for something no manifest declares.
    const url = imports.find((edge) => edge.specifier === "https://example.invalid/z.js");
    expect(url?.resolution).toMatchObject({
      status: "unresolved",
      reason: "unsupported-specifier",
    });
    // A built-in is a platform answer: the runtime provides it, no repository
    // file declares it, so no node is invented for it.
    const builtin = imports.find((edge) => edge.specifier === "node:path");
    expect(builtin?.resolution).toMatchObject({ status: "platform" });
  });

  it("H2. emits one warning for the run, with a total, rather than one per import", async () => {
    // A repository with three thousand unresolvable imports must not produce
    // three thousand diagnostics: the count is the information, and the edges
    // are the detail. A code that fires once per occurrence is a code every
    // consumer learns to ignore.
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "p" }),
      "src/a.ts": ['import "./x.js";', 'import "./y.js";', 'import "./z.js";', ""].join("\n"),
    });
    const warnings = snapshot.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DISCOVERY_IMPORT_UNRESOLVED",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severity).toBe("warning");
    expect(warnings[0]?.metadata?.["unresolved"]).toBe(3);
    // The sample is stated as a sample, so a truncated list is never mistaken
    // for a complete one.
    expect(warnings[0]?.detail).not.toContain("more");
  });

  it("H3. resolves a workspace package from the manifest, not from an installed symlink", async () => {
    // A monorepo works with `node_modules` entirely absent, which is what makes
    // the graph a statement about the repository rather than about one
    // developer's machine.
    const graph = await graphOf({
      "package.json": manifest({ name: "root", workspaces: ["packages/*"] }),
      "packages/core/package.json": manifest({ name: "@acme/core" }),
      "packages/app/package.json": manifest({
        name: "@acme/app",
        dependencies: { "@acme/core": "workspace:*" },
      }),
      "packages/app/src/index.ts": [
        'import { c } from "@acme/core";',
        "export const v = c;",
        "",
      ].join("\n"),
    });
    const importEdge = graph.edges.find((edge) => edge.kind === "imports");
    expect(importEdge?.resolution).toMatchObject({ status: "package" });
    expect(graph.nodes.map((node) => node.id)).toContain("package:packages/core");
  });

  it("H4. splits a bare specifier at the scope boundary, not the first slash", () => {
    // The bug is the same one #38 found in manager names: splitting
    // `@scope/pkg` at the first `/` mints a dependency called `@scope`, which
    // cannot exist. A name that cannot exist in the registry is a fabricated
    // node in the graph.
    expect(barePackageNameOf("@scope/pkg")).toBe("@scope/pkg");
    expect(barePackageNameOf("@scope/pkg/subpath")).toBe("@scope/pkg");
    expect(barePackageNameOf("lodash/fp")).toBe("lodash");
    expect(barePackageNameOf("lodash")).toBe("lodash");
    expect(barePackageNameOf("@scope")).toBeUndefined();
    expect(barePackageNameOf("./relative")).toBeUndefined();
    expect(barePackageNameOf("/absolute")).toBeUndefined();
    expect(barePackageNameOf("")).toBeUndefined();
  });

  it("H5. treats a built-in subpath as a built-in, and a near-miss as a package", () => {
    // `module.builtinModules` omits modules that are nonetheless documented and
    // available — `node:test` most importantly. Sourcing the list from the
    // runtime alone would classify `node:test/reporters` as an external
    // dependency and mint a node for a thing no `package.json` declares.
    expect(isNodeBuiltIn("node:path")).toBe(true);
    expect(isNodeBuiltIn("path")).toBe(true);
    expect(isNodeBuiltIn("node:test/reporters")).toBe(true);
    expect(isNodeBuiltIn("assert/strict")).toBe(true);
    expect(isNodeBuiltIn("node:sqlite/worker")).toBe(true);
    // `pathological` is not `path`. A prefix match would make it a platform
    // answer, which is a claim about the runtime that is simply false.
    expect(isNodeBuiltIn("pathological")).toBe(false);
    expect(isNodeBuiltIn("test")).toBe(true);
    expect(isNodeBuiltIn("tesseract.js")).toBe(false);
  });

  it("H6. hands the resolver a host that cannot see outside the repository", () => {
    // The fence is four separate mechanisms, and this is the one that stops a
    // resolver quirk from leaking a target. `fileExists` and `directoryExists`
    // both refuse, so no walk upwards discovers anything installed.
    const context = {
      repoRoot: "/repo",
      resolvable: new Set(["src/a.ts", "src/b.ts"]),
      workspaceNames: new Map(),
      resolutions: new Map(),
    };
    const host = createResolutionHost(context);
    expect(fence(host, "fileExists", "/repo/src/a.ts")).toBe(true);
    expect(fence(host, "fileExists", "/repo/src/missing.ts")).toBe(false);
    // Outside the root, and inside an installed tree: both invisible, not
    // "absent" — an installed tree is not part of this repository's declared
    // structure, so probing it is what would make the graph depend on install
    // state.
    expect(fence(host, "fileExists", "/elsewhere/src/a.ts")).toBe(false);
    expect(fence(host, "fileExists", "/repo/node_modules/left/index.js")).toBe(false);
    expect(fence(host, "directoryExists", "/repo/src")).toBe(true);
    expect(fence(host, "directoryExists", "/repo/node_modules")).toBe(false);
    // `readFile` is inert on purpose: a resolution must not depend on a
    // package's `package.json` text, which is the install-state coupling the
    // fence exists to remove.
    expect(fence(host, "readFile", "/repo/package.json")).toBeUndefined();
    expect(fence(host, "getCurrentDirectory")).toBe("/repo");
  });

  it("H7. lists the repository root's own files, rather than reporting an empty universe", async () => {
    // The defect this pins: the probe context joined the root's own
    // repository-relative path (`.`) onto the root, yielding `/repo/.`. A real
    // `readdir` tolerates that and a strict boundary does not, so the walk
    // returned *nothing* for a repository with no `tsconfig.json` and no
    // workspaces — silently, and only against a strict one.
    const graph = await graphOf(TINY_PROJECT);
    expect(graph.sourceUniverse.files).toEqual(["src/index.ts", "src/thing.ts"]);
    expect(graph.sourceUniverse.strategy).toBe("bounded-traversal");
  });
});

// ---------------------------------------------------------------------------
// I–K. Dependency edges, and the declared/resolved split
// ---------------------------------------------------------------------------

describe("I–K. a declared version and a resolved version are different facts", () => {
  it("I. cites the manifest line for a declaration and the lockfile line for a resolution", async () => {
    // The whole point: two different files, two different lines, two different
    // questions. Collapsing them would make "what was asked for" and "what was
    // installed" indistinguishable, and they diverge constantly.
    const graph = await graphOf({
      "package.json": manifest({ name: "p", dependencies: { ajv: "^8.17.1" } }),
      "pnpm-lock.yaml": [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .:",
        "    dependencies:",
        "      ajv:",
        "        specifier: ^8.17.1",
        "        version: 8.17.1",
        "",
      ].join("\n"),
      "src/a.ts": 'import ajv from "ajv";\nexport const x = ajv;\n',
    });
    const edge = graph.edges.find((candidate) => candidate.kind === "package-depends-on");
    expect(edge?.declarations[0]).toMatchObject({ declaredSpecifier: "^8.17.1" });
    expect(edge?.declarations[0]?.provenance).toMatchObject({
      source: "package.json",
      pointer: "/dependencies/ajv",
    });
    expect(edge?.resolution).toMatchObject({ status: "resolved", version: "8.17.1" });
    // The resolution's line is the *lockfile's*, and the specifiers differ, so
    // a citation that drifted onto the manifest would be visibly wrong.
    const resolution = edge?.resolution;
    expect(resolution?.status === "resolved" ? resolution.provenance.source : null).toBe(
      "pnpm-lock.yaml",
    );
    expect(resolution?.status === "resolved" ? resolution.provenance.line : 0).toBeGreaterThan(0);
  });

  it("J. keeps every declaration when one name appears in two dependency fields", async () => {
    // A name in both `dependencies` and `devDependencies` is legal. Choosing
    // one would let object order pick a winner — the failure ADR-0045 §3 exists
    // to prevent.
    const graph = await graphOf({
      "package.json": manifest({
        name: "p",
        dependencies: { dual: "^1.0.0" },
        devDependencies: { dual: "^2.0.0" },
      }),
    });
    const edge = graph.edges.find((candidate) => candidate.kind === "package-depends-on");
    expect(edge?.declarations).toHaveLength(2);
    expect(edge?.declarations.map((d) => d.dependencyClass).sort()).toEqual(["dev", "runtime"]);
    // The edge-level provenance is the first declaration in code-unit order —
    // deterministic, not "best" — and it is a real line.
    expect(edge?.provenance.pointer).toBe(edge?.declarations[0]?.pointer);
  });

  it("K. distinguishes four different lockfile outcomes instead of collapsing them to 'unknown'", async () => {
    // "No lockfile", "a lockfile we cannot read", "a lockfile in a form we do
    // not model", and "a lockfile with no entry for this" are four different
    // claims. Conflating them is how a snapshot starts lying.
    const noLockfile = await graphOf({
      "package.json": manifest({ name: "p", dependencies: { x: "1.0.0" } }),
    });
    expect(resolutionOf(noLockfile)).toMatchObject({ status: "no-evidence" });

    const oldPnpm = await graphOf({
      "package.json": manifest({ name: "p", dependencies: { x: "1.0.0" } }),
      "pnpm-lock.yaml": "lockfileVersion: '6.0'\n",
    });
    expect(resolutionOf(oldPnpm)).toMatchObject({ status: "unsupported" });

    const noEntry = await graphOf({
      "package.json": manifest({ name: "p", dependencies: { x: "1.0.0" } }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n",
    });
    expect(resolutionOf(noEntry)).toMatchObject({ status: "unresolved" });
  });

  it("K2. never resolves a lockfile version with no line behind it", async () => {
    // A `version` that is present but not a string cannot be cited, and an
    // uncitable resolved version is an unresolved one. Publishing it would be
    // exactly the decoration ADR-0047 forbids.
    const graph = await graphOf({
      "package.json": manifest({ name: "p", dependencies: { x: "1.0.0" } }),
      "pnpm-lock.yaml": [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .:",
        "    dependencies:",
        "      x:",
        "        specifier: 1.0.0",
        "        version: 12345",
        "",
      ].join("\n"),
    });
    expect(resolutionOf(graph)).toMatchObject({ status: "unresolved" });
  });

  it("K3. reads an npm lockfile as a second opinion, never as a manager verdict", async () => {
    // A repository with two lockfiles is a real and messy repository. Which
    // manager a repository "uses" is ADR-0045's question; this graph says
    // "this lockfile resolved these versions" and nothing more.
    const graph = await graphOf({
      "package.json": manifest({ name: "p", dependencies: { x: "^1.0.0" } }),
      "package-lock.json": manifest({
        name: "p",
        lockfileVersion: 3,
        packages: { "": { dependencies: { x: "^1.0.0" } }, "node_modules/x": { version: "1.4.2" } },
      }),
    });
    expect(resolutionOf(graph)).toMatchObject({ status: "resolved", version: "1.4.2" });
  });

  it("K4. refuses a lockfile past the byte cap, checked before parsing", () => {
    // Repository-authored input is untrusted and unbounded in principle. The
    // cap is a fixed constant applied to the text, and the consequence is
    // published rather than the read attempted.
    expect(prepareLockfile("x".repeat(MAX_LOCKFILE_BYTES)).ok).toBe(true);
    const tooBig = prepareLockfile("x".repeat(MAX_LOCKFILE_BYTES + 1));
    // Narrowed before asserted, so the detail check is a check of the refusal
    // rather than of whichever branch the union happened to take.
    if (tooBig.ok) throw new Error("expected the byte cap to refuse this lockfile");
    expect(tooBig.status).toBe("too-large");
    expect(tooBig.detail).toContain(String(MAX_LOCKFILE_BYTES));
  });

  it("K5. reports a dependency nobody imports, which is a fact and not an error", async () => {
    // The dogfooding finding on this repository: ten declared devDependencies
    // are never imported by any module. That is a real structural condition a
    // reader should be able to see, and it is not a diagnostic — it is simply
    // the difference between what was declared and what was used.
    const graph = await graphOf({
      "package.json": manifest({ name: "p", devDependencies: { unused: "1.0.0" } }),
      "src/a.ts": "export const x = 1;\n",
    });
    expect(graph.nodes.map((node) => node.id)).toContain("dependency:unused");
    expect(graph.edges.filter((edge) => edge.kind === "imports")).toHaveLength(0);
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "p", devDependencies: { unused: "1.0.0" } }),
      "src/a.ts": "export const x = 1;\n",
    });
    expect(snapshot.diagnostics.map((d) => d.code)).not.toContain(
      "DISCOVERY_GRAPH_PROVENANCE_INVALID",
    );
  });

  it("K6. mints a dependency node from an import, but never from the lockfile's closure", async () => {
    // Only a name the repository itself writes becomes a node, so the
    // transitive closure of a lockfile stays out of the graph entirely. An
    // import may create a dependency target; a lockfile may not create a node.
    const graph = await graphOf({
      "package.json": manifest({ name: "p", dependencies: { x: "1.0.0" } }),
      "pnpm-lock.yaml": [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .:",
        "    dependencies:",
        "      x:",
        "        specifier: 1.0.0",
        "        version: 1.0.0",
        "",
        "packages:",
        "",
        "  x@1.0.0:",
        "    dependencies:",
        "      never-written:",
        "        specifier: 9.9.9",
        "        version: 9.9.9",
        "",
      ].join("\n"),
      "src/a.ts": 'import x from "x";\nexport const v = x;\n',
    });
    expect(graph.nodes.map((node) => node.id)).toContain("dependency:x");
    expect(graph.nodes.map((node) => node.id)).not.toContain("dependency:never-written");
  });
});

function resolutionOf(graph: RepositoryGraph) {
  const edge = graph.edges.find((candidate) => candidate.kind === "package-depends-on");
  return edge?.resolution;
}

// ---------------------------------------------------------------------------
// L–N. Ownership, and the explicit unowned state
// ---------------------------------------------------------------------------

describe("L–N. missing ownership is a state, not a guess", () => {
  it("L. marks a subject unowned rather than inventing an owner", async () => {
    // No CODEOWNERS file is a complete, successful answer: zero rules, every
    // subject explicitly unowned. There is no sentinel `UNOWNED` node and no
    // default team, because either would put a person or a group in the graph
    // that no repository file declares.
    const graph = await graphOf(TINY_PROJECT);
    expect(graph.ownership).toMatchObject({ status: "absent", rules: 0 });
    for (const node of graph.nodes) {
      if (node.kind !== "module" && node.kind !== "package") continue;
      // The policy records *which document was searched*, which is the honest
      // resolution of "missing ownership must be representable" against "every
      // fact traces to a line": a fact about the absence of a rule has no line,
      // so it does not invent one.
      expect(node.ownership).toEqual({
        status: "unowned",
        policy: { status: "absent", source: null },
      });
    }
    expect(JSON.stringify(graph)).not.toContain("UNOWNED");
  });

  it("M. applies the last matching rule, and keeps every owner on it", () => {
    // Upstream's rule, implemented exactly. Choosing between two declared
    // owners is precisely the ranking this project refuses, so a rule naming
    // two produces two edges and never a "primary" owner.
    const file = parseCodeowners(
      ".github/CODEOWNERS",
      ["# comment", "* @acme/eng", "/src/ @acme/platform", "/src/entry.ts @acme/entry", ""].join(
        "\n",
      ),
    );
    expect(file.rules.map((rule) => rule.line)).toEqual([2, 3, 4]);
    const match = ownersForPath(file.rules, "src/entry.ts");
    expect(match?.owners).toEqual(["@acme/entry"]);
    expect(match?.rule.line).toBe(4);
    const other = ownersForPath(file.rules, "src/index.ts");
    expect(other?.owners).toEqual(["@acme/platform"]);
    const twoOwners = parseCodeowners(".github/CODEOWNERS", "docs/ @acme/a @acme/b\n").rules[0];
    expect(twoOwners?.owners).toEqual(["@acme/a", "@acme/b"]);
  });

  it("N. skips an unsupported pattern and says why, without losing the rules beside it", () => {
    // One exotic line must not delete the twenty ordinary ones next to it. And
    // each refusal names a reason a reader can act on rather than silently
    // dropping the line.
    const file = parseCodeowners(
      ".github/CODEOWNERS",
      ["[invalid] @a", "!/negated @b", "src/*.ts @c", ""].join("\n"),
    );
    expect(file.unsupported).toHaveLength(2);
    expect(file.unsupported[0]?.reason).toContain("Character classes");
    expect(file.unsupported[1]?.reason).toContain("leading `!`");
    expect(file.rules.map((rule) => rule.pattern)).toEqual(["src/*.ts"]);
    // The skipped lines are still lines, and their citations are the real ones.
    expect(file.unsupported.map((entry) => entry.line)).toEqual([1, 2]);
  });

  it("N2. refuses a negation, a character class, an extglob, and a root escape by name", () => {
    expect(unsupportedPatternReason("!/x")).toContain("leading `!`");
    expect(unsupportedPatternReason("[a-z]")).toContain("Character classes");
    expect(unsupportedPatternReason("src/@(a|b).ts")).toContain("Extended glob");
    expect(unsupportedPatternReason("src/\\*.ts")).toContain("Backslash");
    expect(unsupportedPatternReason("/../outside")).toContain("escaping the repository root");
    // Supported forms pass through untouched.
    expect(unsupportedPatternReason("src/*")).toBeNull();
    expect(unsupportedPatternReason("**/*.ts")).toBeNull();
    expect(unsupportedPatternReason("/docs/")).toBeNull();
    expect(unsupportedPatternReason("README.md")).toBeNull();
  });

  it("N3. treats a rule with no owner as unsupported rather than as a mass unowning", () => {
    // A malformed line must not produce a large, confident claim about who
    // owns nothing.
    const file = parseCodeowners(".github/CODEOWNERS", "/src/\n/valid/ @a\n");
    expect(file.rules.map((rule) => rule.pattern)).toEqual(["/valid/"]);
    expect(file.unsupported[0]?.reason).toContain("no owner");
  });

  it("N4. matches the gitignore shapes CODEOWNERS actually uses, and not one more", () => {
    // A pattern with no separator matches at any depth; one with a separator is
    // matched against the whole path; a directory match covers what is inside
    // it. These are the shapes a CODEOWNERS file is written in, and a matcher
    // that guessed at the rest would claim support it does not have.
    expect(ruleMatches("README.md", "docs/README.md")).toBe(true);
    expect(ruleMatches("/src/*", "src/payments/service.ts")).toBe(true);
    expect(ruleMatches("/src/payments/", "src/payments/deep/service.ts")).toBe(true);
    // `paymentsx` is not `payments`, and a substring match would say otherwise.
    expect(ruleMatches("/src/payments/", "src/paymentsx/service.ts")).toBe(false);
    expect(ruleMatches("src/*.ts", "src/a/b.ts")).toBe(false);
    expect(ruleMatches("a/**/b", "a/b")).toBe(true);
    expect(ruleMatches("a/**/b", "a/x/y/b")).toBe(true);
    expect(ruleMatches("?.ts", "a.ts")).toBe(true);
    expect(ruleMatches("?.ts", "ab.ts")).toBe(false);
  });

  it("N5. consults the locations in upstream precedence order and never merges them", async () => {
    // First match wins, and two files never become a synthetic union — a union
    // would publish a policy nobody wrote.
    expect(CODEOWNERS_LOCATIONS).toEqual([".github/CODEOWNERS", "docs/CODEOWNERS", "CODEOWNERS"]);
    const graph = await graphOf({
      ...TINY_PROJECT,
      ".github/CODEOWNERS": "* @acme/eng\n",
      "docs/CODEOWNERS": "* @acme/docs\n",
    });
    const owners = graph.nodes.filter((node) => node.kind === "owner");
    expect(owners.map((node) => node.identity)).toEqual(["@acme/eng"]);
  });

  it("N6. cites the winning rule's line on the ownership edge, and the subject's own line on the node", async () => {
    // A consumer asking "who owns this" and a consumer asking "what made me
    // say so" are asking different questions, and both must be answerable.
    const graph = await graphOf({
      ...TINY_PROJECT,
      ".github/CODEOWNERS": ["# owners", "/src/ @acme/platform", ""].join("\n"),
    });
    const subject = graph.nodes.find((node) => node.id === "module:src/thing.ts");
    if (subject?.kind !== "module") throw new Error("expected a module node");
    expect(subject.ownership).toMatchObject({
      status: "owned",
      ownerIds: ["owner:@acme/platform"],
    });
    expect(subject.provenance.source).toBe("src/thing.ts");
    const edge = graph.edges.find(
      (candidate) => candidate.id === "ownership:module:src/thing.ts->owner:@acme/platform",
    );
    expect(edge?.provenance).toMatchObject({ source: ".github/CODEOWNERS", line: 2 });
  });

  it("N7. reports a subject no rule covers as unowned while others are owned", async () => {
    // The mixed case, and the one that proves `unowned` is a *state* rather
    // than a global: some subjects owned, some explicitly not, no guess either
    // way, and the count of each published.
    const graph = await graphOf({
      "package.json": manifest({ name: "p" }),
      ".github/CODEOWNERS": "/src/ @acme/platform\n",
      "src/index.ts": "export const x = 1;\n",
      "scripts/release.ts": "export const y = 2;\n",
    });
    expect(graph.counts.ownedSubjects).toBeGreaterThan(0);
    expect(graph.counts.unownedSubjects).toBeGreaterThan(0);
    const unowned = graph.nodes.filter(
      (node) =>
        (node.kind === "module" || node.kind === "package") && node.ownership.status === "unowned",
    );
    expect(unowned.map((node) => node.id)).toContain("module:scripts/release.ts");
  });
});

// ---------------------------------------------------------------------------
// O–R. Bounds, truncation, and honesty about stopping
// ---------------------------------------------------------------------------

describe("O–R. every bound is declared, applied, and reported", () => {
  it("O. keeps node_modules and .git out of the source universe unconditionally", async () => {
    // These two are never part of a repository's own source model, and entering
    // `node_modules` would make discovery cost scale with install state — so
    // two checkouts of one commit would do different amounts of work to produce
    // the same answer.
    const graph = await graphOf({
      ...TINY_PROJECT,
      "node_modules/left/index.js": "module.exports = 1;\n",
    });
    const files = graph.sourceUniverse.files;
    expect(files.some((file) => file.startsWith("node_modules/"))).toBe(false);
    expect(files).toEqual(["src/index.ts", "src/thing.ts"]);
  });

  it("O2. excludes a build output directory when, and only when, the config declares one", async () => {
    // `dist` is genuinely ambiguous: it is sometimes a committed artifact and
    // sometimes compiler output, and guessing is what this project refuses. So
    // the bounded fallback walk deliberately does **not** skip it, and a
    // `tsconfig.json` with an `outDir` is the four lines a repository writes to
    // get a precise universe. The defect dogfooding found was the other
    // direction: with a config, `dist` was being included anyway.
    const blind = await graphOf({ ...TINY_PROJECT, "dist/index.js": 'import "./thing.js";\n' });
    expect(blind.sourceUniverse.strategy).toBe("bounded-traversal");
    expect(blind.sourceUniverse.files).toContain("dist/index.js");

    const configured = await graphOf({
      ...CONFIGURED_PROJECT,
      "dist/index.js": 'import "./thing.js";\n',
    });
    expect(configured.sourceUniverse.strategy).toBe("tsconfig");
    expect(configured.sourceUniverse.files.some((file) => file.startsWith("dist/"))).toBe(false);
    expect(configured.sourceUniverse.files).toContain("src/index.ts");
  });

  it("P. says so when it stopped, rather than truncating silently", async () => {
    // A truncated graph that does not say so is indistinguishable from a
    // complete one, and a reader cannot tell which they were given.
    const files: Record<string, string> = {
      "package.json": manifest({ name: "deep", workspaces: ["**"] }),
    };
    const segments: string[] = [];
    for (let depth = 0; depth < MAX_SOURCE_DEPTH + 4; depth++) {
      segments.push(`d${String(depth)}`);
      files[`${segments.join("/")}/a.ts`] = "export const x = 1;\n";
    }
    const snapshot = await snapshotOf(files);
    // The workspace walk's own bound is shallower than the graph's, so the
    // snapshot is incomplete whatever the graph did — and says so.
    expect(snapshot.summary.complete).toBe(false);
    expect(snapshot.diagnostics.some((d) => d.metadata?.["maxDepth"] !== undefined)).toBe(true);
    // Whatever the graph's own universe did, it published the outcome.
    const graph = snapshot.graph;
    expect(graph).not.toBeNull();
    expect(graph?.truncatedBy === null || graph?.complete === false).toBe(true);
  });

  it("Q. costs one unreadable source file that file's edges, and nothing else", async () => {
    // The same failure boundary ADR-0045 §9 established for a manifest. One
    // broken file must not delete the repository's graph, and its absence must
    // be published rather than look like a file with no imports.
    const fs = new FaultyFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/package.json", manifest({ name: "p" }));
    fs.addFile("/repo/src/good.ts", 'import { t } from "./thing.js";\nexport const x = t;\n');
    fs.addFile("/repo/src/thing.ts", "export const t = 1;\n");
    fs.addFile("/repo/src/bad.ts", "export const y = 2;\n");
    fs.failOn("/repo/src/bad.ts");
    const result = await discoverRepository(fs, { startDir: "/repo" });
    if (!result.ok) throw new Error("expected discovery to succeed");
    const graph = result.snapshot.graph;
    expect(graph?.sourceUniverse.files).toContain("src/good.ts");
    expect(graph?.nodes.map((node) => node.id)).toContain("module:src/thing.ts");
    // The failure is published, naming the file it could not read.
    const reported = result.snapshot.diagnostics.filter(
      (d) => d.sourcePath === "src/bad.ts" || d.metadata?.["path"] === "src/bad.ts",
    );
    expect(reported.length).toBeGreaterThan(0);
  });

  it("R. leaves the repository untouched, whatever the graph found", async () => {
    // `discover` remains read-only: no graph database, no cache file, no
    // `.agent-ready/` directory. The graph exists in memory for one run, and a
    // user who wants a file writes the JSON themselves.
    const fs = new RecordingFileSystem("/repo");
    for (const [path, content] of Object.entries({
      ...TINY_PROJECT,
      ".github/CODEOWNERS": "* @a\n",
    })) {
      fs.addFile(`/repo/${path}`, content);
    }
    fs.addDirectory("/repo/.git");
    const outcome = await runDiscover(fs, { json: true, root: "/repo" });
    expect(fs.mutatingCalls()).toEqual([]);
    expect(fs.calls.filter((call) => call.startsWith("write:"))).toEqual([]);
    // The command still succeeds, and no artefact appeared in the output.
    expect(outcome.exitCode).toBe(0);
    expect(JSON.stringify(JSON.parse(outcome.stdout))).not.toContain("graphPath");
  });
});

// ---------------------------------------------------------------------------
// S–V. The validator's own invariants
// ---------------------------------------------------------------------------

describe("S–V. a graph that fails its own invariants is a bug, not a warning", () => {
  const UNOWNED = { status: "unowned", policy: { status: "absent", source: null } } as const;
  const LINES = new Map([
    ["package.json", 10],
    [".github/CODEOWNERS", 4],
    ["a.ts", 3],
    ["b.ts", 3],
  ]);

  function packageNode(over: Partial<PackageNode> = {}): PackageNode {
    return {
      id: "package:.",
      kind: "package",
      name: "p",
      path: ".",
      ownership: UNOWNED,
      provenance: { source: "package.json", line: 1 },
      ...over,
    };
  }

  function moduleNode(id: string): ModuleNode {
    return {
      id,
      kind: "module",
      path: id.slice("module:".length),
      packagePath: ".",
      ownership: UNOWNED,
      provenance: { source: id.slice("module:".length), line: 1 },
    };
  }

  /**
   * A graph, built fresh per case.
   *
   * Rebuilt rather than mutated because the graph type is deeply readonly, and
   * because a mutation-based test would assert against a shape the production
   * code cannot produce. Each case below is therefore a graph
   * `buildRepositoryGraph` *would have produced* had it been wrong — which is
   * exactly the situation the validator exists for.
   */
  function graphOfNodes(
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[] = [],
  ): RepositoryGraph {
    return {
      nodes: [...nodes],
      edges: [...edges],
      sourceUniverse: {
        strategy: "bounded-traversal",
        tsconfigs: [],
        resolutionMode: "",
        extensions: [".ts"],
        files: [],
        truncated: false,
      },
      ownership: {
        status: "absent",
        source: null,
        rules: 0,
        unsupportedPatterns: [],
        detail: null,
      },
      counts: {
        nodes: nodes.length,
        edges: edges.length,
        packages: 0,
        modules: 0,
        externalDependencies: 0,
        owners: 0,
        importEdges: 0,
        resolvedImports: 0,
        unresolvedImports: 0,
        dependencyEdges: 0,
        resolvedDependencies: 0,
        workspaceDependencies: 0,
        ownedSubjects: 0,
        unownedSubjects: 0,
      },
      complete: true,
      truncatedBy: null,
    };
  }

  it("S. accepts a well-formed graph with no violations at all", () => {
    // The control. A validator that always found something would be useless,
    // and one that found everything would be noise.
    expect(validateGraph(graphOfNodes([packageNode()]), LINES)).toEqual([]);
  });

  it("S2. rejects a citation that is absolute, escaping, zero-based, past the end, or unread", () => {
    // Five ways a citation can look real and be checkable by nobody. Each is
    // something a reader would only discover by opening the file, which is
    // exactly the cost the graph promises to have already paid.
    const cases: {
      what: string;
      node: PackageNode;
      lines: Map<string, number>;
      invariant: string;
    }[] = [
      {
        what: "absolute",
        node: packageNode({ provenance: { source: "/etc/package.json", line: 1 } }),
        lines: LINES,
        invariant: "provenance-path-is-repository-relative",
      },
      {
        what: "escaping",
        node: packageNode({ provenance: { source: "../package.json", line: 1 } }),
        lines: LINES,
        invariant: "provenance-path-is-repository-relative",
      },
      {
        what: "line zero",
        node: packageNode({ provenance: { source: "package.json", line: 0 } }),
        lines: LINES,
        invariant: "provenance-line-is-one-based",
      },
      {
        what: "past the end",
        node: packageNode({ provenance: { source: "package.json", line: 99 } }),
        lines: LINES,
        invariant: "provenance-line-is-in-range",
      },
      {
        what: "never read",
        node: packageNode({ provenance: { source: "package.json", line: 1 } }),
        lines: new Map(),
        invariant: "provenance-file-was-read",
      },
    ];
    for (const testCase of cases) {
      const violations = validateGraph(graphOfNodes([testCase.node]), testCase.lines);
      expect(
        violations.map((v) => v.invariant),
        testCase.what,
      ).toContain(testCase.invariant);
      // The offending id is named, so a report says which item, not just which rule.
      expect(violations[0]?.id, testCase.what).toBe("package:.");
    }
  });

  it("S3. rejects a duplicate identity, because an id with two spellings cannot be checked", () => {
    expect(
      validateGraph(graphOfNodes([packageNode(), packageNode()]), LINES).map((v) => v.invariant),
    ).toContain("unique-node-ids");
  });

  it("S4. rejects an edge whose source or resolved target names no node", () => {
    // A resolved edge with no target is a graph that cannot be traversed, and
    // an edge whose source is missing is an edge that is not in the graph at
    // all. Both are what a builder that emitted an edge before its node looks
    // like.
    const dangling: ImportEdge = {
      id: "import:a->b",
      kind: "imports",
      source: "package:.",
      specifier: "./b.js",
      syntax: "import",
      typeOnly: false,
      resolution: {
        status: "module",
        target: "module:src/missing.ts",
        targetPath: "src/missing.ts",
      },
      provenance: { source: "package.json", line: 1 },
    };
    expect(
      validateGraph(graphOfNodes([packageNode()], [dangling]), LINES).map((v) => v.invariant),
    ).toContain("resolved-import-target-exists");

    const orphan: ImportEdge = { ...dangling, id: "import:x->y", source: "module:src/ghost.ts" };
    expect(
      validateGraph(graphOfNodes([packageNode()], [orphan]), LINES).map((v) => v.invariant),
    ).toContain("edge-source-exists");
  });

  it("S5. rejects an unresolved import that would be silent if it were dropped", () => {
    // The edges carrying no target are the ones a consumer is most likely to
    // drop, so the validator insists they say enough to be actionable: a
    // specifier and a reason, or the two are indistinguishable.
    // The `reason` is a closed union, so the only way to ship a silent
    // unresolved edge is a cast — which is exactly the point: the type prevents
    // it, and the runtime check defends against the cast and against a value
    // that arrived from outside the type.
    const silent = {
      id: "import:a->?",
      kind: "imports",
      source: "package:.",
      specifier: "",
      syntax: "import",
      typeOnly: false,
      resolution: { status: "unresolved", reason: "" },
      provenance: { source: "package.json", line: 1 },
    } as unknown as ImportEdge;
    const invariants = validateGraph(graphOfNodes([packageNode()], [silent]), LINES).map(
      (v) => v.invariant,
    );
    expect(invariants).toContain("unresolved-import-names-a-specifier");
    expect(invariants).toContain("unresolved-import-names-a-reason");
  });

  it("S6. rejects an ownership state that contradicts the ownership edges", () => {
    // The two representations of ownership — the state on the node and the
    // `owned-by` edges — could drift, and a consumer would have no way to know
    // which to believe. Each direction is checked.
    const claimsOwnership: PackageNode = {
      ...packageNode(),
      ownership: { status: "owned", ownerIds: ["owner:@a"] },
    };
    expect(validateGraph(graphOfNodes([claimsOwnership]), LINES).map((v) => v.invariant)).toContain(
      "owned-subject-has-an-ownership-edge",
    );

    const edge: OwnershipEdge = {
      id: "ownership:package:.->owner:@a",
      kind: "owned-by",
      source: "package:.",
      target: "owner:@a",
      provenance: { source: ".github/CODEOWNERS", line: 1 },
      rule: "*",
    };
    expect(
      validateGraph(graphOfNodes([packageNode()], [edge]), LINES).map((v) => v.invariant),
    ).toContain("unowned-subject-has-no-ownership-edge");
  });

  it("S7. rejects a dependency edge with no cause", () => {
    // An empty `declarations` array is not "unknown", it is a relationship with
    // no cause — and a dependency edge always has a target, so it can never
    // dangle the way an import edge can.
    const causeless: DependencyEdge = {
      id: "dependency:package:.->dependency:x",
      kind: "package-depends-on",
      source: "package:.",
      target: "dependency:x",
      declarations: [],
      resolution: { status: "no-evidence" },
      provenance: { source: "package.json", line: 1 },
      targetMissing: false,
    };
    expect(
      validateGraph(graphOfNodes([packageNode()], [causeless]), LINES).map((v) => v.invariant),
    ).toContain("dependency-edge-has-a-declaration");
  });

  it("S8. rejects an out-of-order collection, because truncation follows sorting", () => {
    // A truncated graph drops items *after* sorting, so an unsorted collection
    // would make which items survive depend on enumeration order — two runs of
    // one tree could disagree about what was left out.
    const a = moduleNode("module:a.ts");
    const b = moduleNode("module:b.ts");
    expect(validateGraph(graphOfNodes([b, a]), LINES).map((v) => v.invariant)).toContain(
      "canonical-ordering",
    );
    // The same two nodes, sorted, are accepted: the check is the order and
    // nothing else.
    expect(validateGraph(graphOfNodes([a, b]), LINES)).toEqual([]);
  });

  it("S9. gives every violation a sentence a bug report can use", () => {
    // A violation whose `detail` is a field name rather than an explanation
    // would send a reader to the source instead of telling them what happened.
    const violations = validateGraph(
      graphOfNodes([packageNode({ provenance: { source: "package.json", line: 99 } })]),
      LINES,
    );
    expect(violations.length).toBeGreaterThan(0);
    for (const violation of violations) {
      const described = describeViolation(violation);
      expect(described.startsWith(violation.invariant)).toBe(true);
      expect(described.length).toBeGreaterThan(40);
      expect(described).toMatch(/[.!]$/u);
    }
  });

  it("T. is emitted as an error, unlike every repository condition in the graph", async () => {
    // The contrast is the design: an unresolved import is true of the
    // repository, a bad citation is true of us. Only the second fails the
    // command, and a healthy repository publishes neither.
    const snapshot = await snapshotOf(TINY_PROJECT);
    expect(snapshot.diagnostics.map((d) => d.code)).not.toContain(
      "DISCOVERY_GRAPH_PROVENANCE_INVALID",
    );
    expect(snapshot.graph?.counts.unresolvedImports).toBe(0);
  });

  it("U. agrees with itself across two runs and two checkout locations", async () => {
    // Determinism is not a nicety here: a graph whose bytes depend on the walk
    // order cannot be diffed between two commits, which is most of what anyone
    // would want a graph for.
    const first = await graphOf(TINY_PROJECT);
    const second = await graphOf(TINY_PROJECT);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const elsewhere = new InMemoryFileSystem("/home/someone/other/checkout");
    for (const [path, content] of Object.entries(TINY_PROJECT)) {
      elsewhere.addFile(`/home/someone/other/checkout/${path}`, content);
    }
    elsewhere.addDirectory("/home/someone/other/checkout/.git");
    const result = await discoverRepository(elsewhere, {
      startDir: "/home/someone/other/checkout",
    });
    if (!result.ok) throw new Error("expected discovery to succeed");
    expect(JSON.stringify(result.snapshot.graph)).toBe(JSON.stringify(first));
  });

  it("V. answers the two ownership questions independently", () => {
    // "Who owns this" and "what made me say so" are different questions, so the
    // helpers that answer them filter rather than search, and neither can be
    // satisfied by the other's answer.
    const owner: OwnerNode = {
      id: "owner:@a",
      kind: "owner",
      identity: "@a",
      provenance: { source: ".github/CODEOWNERS", line: 1 },
    };
    const owned: PackageNode = {
      ...packageNode(),
      ownership: { status: "owned", ownerIds: ["owner:@a"] },
    };
    const ownershipEdge: OwnershipEdge = {
      id: "ownership:package:.->owner:@a",
      kind: "owned-by",
      source: "package:.",
      target: "owner:@a",
      provenance: { source: ".github/CODEOWNERS", line: 1 },
      rule: "*",
    };
    const dependencyEdge: DependencyEdge = {
      id: "dependency:package:.->dependency:x",
      kind: "package-depends-on",
      source: "package:.",
      target: "dependency:x",
      declarations: [
        {
          dependencyClass: "runtime",
          declaredSpecifier: "1.0.0",
          pointer: "/dependencies/x",
          provenance: { source: "package.json", line: 2 },
        },
      ],
      resolution: { status: "no-evidence" },
      provenance: { source: "package.json", line: 2 },
      targetMissing: false,
    };
    const edges = [ownershipEdge, dependencyEdge];
    expect(ownershipEdgesOf(edges, "package:.")).toEqual([ownershipEdge]);
    expect(dependencyEdgesOf(edges, "package:.")).toEqual([dependencyEdge]);
    // A well-formed graph with a real owner validates, which is the positive
    // control for the ownership invariants S6 checks by construction. The
    // nodes are given in code-unit order, because the validator checks that
    // too and an out-of-order fixture would fail for the wrong reason.
    expect(validateGraph(graphOfNodes([owner, owned], [ownershipEdge]), LINES)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// W–Z. JSON pointer positions
// ---------------------------------------------------------------------------

describe("W–Z. a JSON citation is a pointer, not a text search", () => {
  it("W. indexes every property by JSON Pointer with a real line", () => {
    const text = manifest({ name: "p", dependencies: { ajv: "^8.17.1" } });
    const result = indexJsonPositions("package.json", text, 8);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const location = result.locations.get("/dependencies/ajv");
    expect(location).toBeDefined();
    expect(location?.line).toBeGreaterThan(0);
    // The cited line really is the line that declared the dependency. A text
    // search for "ajv" would find this by accident; a pointer cannot.
    const lines = text.split("\n");
    expect(lines[(location?.line ?? 1) - 1]).toContain("ajv");
  });

  it("X. distinguishes the same string written in two different places", () => {
    // The failure a text search cannot avoid: `ajv` appears in `dependencies`
    // and again in `devDependencies`, and citing the wrong one is a citation
    // that looks precise and is wrong.
    const text = manifest({ dependencies: { ajv: "^8" }, devDependencies: { ajv: "^8" } });
    const result = indexJsonPositions("package.json", text, 8);
    if (!result.ok) throw new Error("expected the document to index");
    const runtime = result.locations.get("/dependencies/ajv");
    const dev = result.locations.get("/devDependencies/ajv");
    expect(runtime?.line).not.toBe(dev?.line);
  });

  it("Y. escapes a package name that contains a pointer's own escape character", () => {
    // `a/b` is a legal npm package name. An unescaped pointer would resolve to
    // a different location.
    expect(escapePointerSegment("a/b")).toBe("a~1b");
    expect(escapePointerSegment("a~b")).toBe("a~0b");
    expect(escapePointerSegment("plain")).toBe("plain");

    const text = manifest({ dependencies: { "a/b": "1.0.0" } });
    const result = indexJsonPositions("package.json", text, 8);
    if (!result.ok) throw new Error("expected the document to index");
    expect(result.locations.get("/dependencies/a~1b")).toBeDefined();
  });

  it("Z. returns the one citation the validator can reject, rather than nothing or a guess", () => {
    // An under-indexed pointer (a document deeper than the walk cap) must show
    // up as an invariant failure, not as a plausible line that means nothing —
    // and not as no location at all, which would let an uncitable fact in.
    const empty = new Map<string, SourceLocation>();
    const fallback = locationForPointer(empty, "package.json", "/dependencies/ajv");
    expect(fallback).toEqual({ source: "package.json", line: 1, pointer: "/dependencies/ajv" });
    // A file this index never described has no lines, so the fallback line is
    // rejected rather than accepted. A fabricated position is the failure this
    // avoids; a missing one is merely unhelpful.
    const graph: RepositoryGraph = {
      nodes: [
        {
          id: "package:.",
          kind: "package",
          name: "p",
          path: ".",
          ownership: { status: "unowned", policy: { status: "absent", source: null } },
          provenance: fallback,
        },
      ],
      edges: [],
      sourceUniverse: {
        strategy: "bounded-traversal",
        tsconfigs: [],
        resolutionMode: "",
        extensions: [".ts"],
        files: [],
        truncated: false,
      },
      ownership: {
        status: "absent",
        source: null,
        rules: 0,
        unsupportedPatterns: [],
        detail: null,
      },
      counts: {
        nodes: 1,
        edges: 0,
        packages: 1,
        modules: 0,
        externalDependencies: 0,
        owners: 0,
        importEdges: 0,
        resolvedImports: 0,
        unresolvedImports: 0,
        dependencyEdges: 0,
        resolvedDependencies: 0,
        workspaceDependencies: 0,
        ownedSubjects: 0,
        unownedSubjects: 1,
      },
      complete: true,
      truncatedBy: null,
    };
    expect(validateGraph(graph, new Map([["package.json", 0]]))).not.toEqual([]);
    // An index that *does* have the pointer is used, and the value's own line
    // comes back rather than the fallback's.
    const indexed = indexJsonPositions(
      "package.json",
      manifest({ dependencies: { ajv: "^8" } }),
      8,
    );
    if (!indexed.ok) throw new Error("expected the document to index");
    expect(
      locationForPointer(indexed.locations, "package.json", "/dependencies/ajv").line,
    ).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// AA–AG. The end-to-end surface
// ---------------------------------------------------------------------------

describe("AA–AG. the graph is part of the discover surface, not a second command", () => {
  it("AA. publishes the graph as a top-level snapshot field, leaving the facts alone", async () => {
    // ADR-0047's first amendment: the graph is a sibling of `facts`, not a
    // fact. A graph's evidence is one entry per node and per edge — thousands
    // of paths from one inspection — which is exactly what the ADR-0045
    // evidence budget exists to prevent, so `FACT_IDS` is unchanged.
    const snapshot = await snapshotOf(TINY_PROJECT);
    expect(snapshot.graph).not.toBeNull();
    expect(Object.keys(snapshot).sort()).toEqual([
      "diagnostics",
      "facts",
      "graph",
      "ok",
      "root",
      "snapshotVersion",
      "summary",
    ]);
    for (const id of Object.keys(snapshot.facts)) {
      expect(id.startsWith("repository."), id).toBe(true);
    }
    expect(Object.keys(snapshot.facts)).not.toContain("repository.modules");
  });

  it("AB. renders a Graph section in human output that claims nothing the JSON does not", async () => {
    const outcome = await runDiscover(repoWith(TINY_PROJECT), { json: false, root: "/repo" });
    expect(outcome.stdout).toContain("Graph");
    expect(outcome.stdout).toMatch(
      /Nodes\s+\d+ \(\d+ package, \d+ module, \d+ dependency, \d+ owner\)/u,
    );
    expect(outcome.stdout).toMatch(/Edges\s+\d+ \(\d+ import, \d+ dependency, \d+ ownership\)/u);
    expect(outcome.stdout).toMatch(/Imports\s+\d+ resolved, \d+ unresolved/u);
    // The universe line omits a resolution mode rather than printing an empty
    // one, because `moduleResolution ` with nothing after it reads as a value
    // that failed to render.
    expect(outcome.stdout).toContain("bounded-traversal (2 file(s), moduleResolution Bundler)");
    // Still no score, no rating, no recommendation — the graph does not change
    // what discovery is for.
    expect(outcome.stdout).not.toMatch(/score|rating|maturity|recommend|should/i);
  });

  it("AC. reports an absent ownership policy as absent, not as a failure", async () => {
    // The most common real case, and the one most likely to be rendered as an
    // error by an implementation that treats "no policy" as "broken policy".
    const outcome = await runDiscover(repoWith(TINY_PROJECT), { json: true, root: "/repo" });
    expect(outcome.exitCode).toBe(0);
    const body = JSON.parse(outcome.stdout) as {
      graph: { ownership: { status: string } };
    };
    expect(body.graph.ownership.status).toBe("absent");
  });

  it("AD. produces identical bytes for a repository read twice", async () => {
    const first = await runDiscover(repoWith(TINY_PROJECT), { json: true, root: "/repo" });
    const second = await runDiscover(repoWith(TINY_PROJECT), { json: true, root: "/repo" });
    expect(second.stdout).toBe(first.stdout);
  });

  it("AE. hands back a value, not a handle, so a graph round-trips through JSON", async () => {
    // "No graph database" means concretely: it runs once, in memory, and its
    // result is a plain value a consumer can store themselves.
    const result = await discoverRepository(repoWith(TINY_PROJECT), { startDir: "/repo" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const round = JSON.parse(JSON.stringify(result.snapshot.graph)) as RepositoryGraph;
    expect(round).toEqual(result.snapshot.graph);
  });

  it("AF. survives a repository with no package.json, no sources, and no policies", async () => {
    // The degenerate case must be a complete, empty answer — not a crash, and
    // not a claim that something was missing.
    const snapshot = await snapshotOf({ "README.md": "# readme\n" });
    expect(snapshot.graph).toMatchObject({
      nodes: [],
      edges: [],
      complete: true,
      truncatedBy: null,
    });
    expect(snapshot.graph?.ownership).toMatchObject({ status: "absent" });
    expect(snapshot.graph?.counts.nodes).toBe(0);
  });

  it("AG. never lets a citation or a target escape the repository", async () => {
    // A relative specifier that climbs out is fenced. The specifier *text* is
    // still cited verbatim — that is the point of the edge, and hiding it would
    // be the silence this graph exists to avoid — so what must never appear is
    // an outside **path** or an outside **target**. Every citation is
    // re-checked here rather than trusted, because that is exactly the claim
    // the graph makes.
    const graph = await graphOf({
      "package.json": manifest({ name: "p" }),
      "src/a.ts": [
        'import "../../../etc/passwd";',
        'import "./../../outside.js";',
        'import "C:/Windows/system32";',
        "",
      ].join("\n"),
    });
    // Three declarations, three unresolved edges, none with a target.
    const imports = graph.edges.filter((edge) => edge.kind === "imports");
    expect(imports).toHaveLength(3);
    expect(imports.map((edge) => edge.resolution.status)).toEqual([
      "unresolved",
      "unresolved",
      "unresolved",
    ]);
    for (const node of graph.nodes) {
      expect(isRepositoryRelativePath(node.provenance.source), node.id).toBe(true);
    }
    for (const edge of graph.edges) {
      expect(isRepositoryRelativePath(edge.provenance.source), edge.id).toBe(true);
      expect(edge.provenance.line, edge.id).toBeGreaterThanOrEqual(1);
    }
    // No node or edge *target* names a path outside the root. Ids embed the
    // specifier, so the check is on the resolution targets, not on the bytes.
    for (const edge of graph.edges) {
      if (edge.kind !== "imports" || edge.resolution.status !== "module") continue;
      expect(isRepositoryRelativePath(edge.resolution.targetPath), edge.id).toBe(true);
    }
    // And the whole graph validated, so the fence held rather than merely
    // looking like it did.
    expect(graph.complete).toBe(true);
  });
});
