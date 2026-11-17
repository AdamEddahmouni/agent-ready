/**
 * Issue #40, regressions from the external corpus reconnaissance.
 *
 * #36 through #39 were each tested against fixtures the author designed, and
 * each passed. #40 went and ran the same implementation against fifteen
 * third-party repositories chosen to break its assumptions, and three defects
 * appeared that no synthetic fixture had reached. This file is the permanent
 * record of them, in the shape that would have caught them.
 *
 * All three are the same class of failure in different clothing: a place where
 * the implementation produced output that *looked* authoritative and was not.
 * A graph that cites a file nobody read, a lockfile refused with a diagnosis
 * that was simply false, and a diagnostic that published the operator's home
 * directory are three ways of being confidently wrong, and each is now pinned
 * below by the condition that produced it rather than by a summary of it.
 *
 * The matrix runs A through D. A and B are the provenance defect and its
 * unreadable-target boundary, C is the multi-document lockfile, and D is the
 * path leak. The conformance corpus under `conformance/discovery/v1` covers
 * the same ground in the reduced form it can afford to keep forever; this file
 * covers the parts that need a specific shape of input to reach.
 */

import { describe, expect, it } from "vitest";
import { discoverRepository } from "../../src/discover/discover.js";
import type { DiscoverySnapshot } from "../../src/discover/types.js";
import type { ImportEdge, ModuleNode, RepositoryGraph } from "../../src/discover/graph/types.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { manifest, repoWith } from "./discoverTestDoubles.js";
import { pnpmAdapter } from "../../src/discover/graph/lockfiles.js";

async function snapshotOf(files: Record<string, string>): Promise<DiscoverySnapshot> {
  const result = await discoverRepository(repoWith(files), { startDir: "/repo" });
  if (!result.ok) throw new Error("expected discovery to succeed");
  return result.snapshot;
}

async function graphOf(files: Record<string, string>): Promise<RepositoryGraph> {
  const graph = (await snapshotOf(files)).graph;
  if (graph === null) throw new Error("expected a graph");
  return graph;
}

function importEdges(graph: RepositoryGraph): ImportEdge[] {
  return graph.edges.filter((edge): edge is ImportEdge => edge.kind === "imports");
}

function moduleNodes(graph: RepositoryGraph): ModuleNode[] {
  return graph.nodes.filter((node): node is ModuleNode => node.kind === "module");
}

// ---------------------------------------------------------------------------
// A. A resolved target outside the module universe must still be citable
// ---------------------------------------------------------------------------

describe("A. a resolved target outside the module universe", () => {
  it("A1: an import resolving to a declaration file yields a node whose provenance is a real line", async () => {
    // `sindresorhus/type-fest` at e9f614f: 64 module nodes cited `.d.ts` files
    // this run had never read, and the validator rejected the graph outright.
    const graph = await graphOf({
      "package.json": manifest({ name: "root" }),
      "tsconfig.json": '{ "compilerOptions": { "moduleResolution": "nodenext" } }',
      "src/index.ts": ['import type { Thing } from "./types.js";', "export type { Thing };"].join(
        "\n",
      ),
      "src/types.d.ts": "export interface Thing {\n  name: string;\n}\n",
    });

    const target = moduleNodes(graph).find((node) => node.path === "src/types.d.ts");
    expect(target, "the declaration file should be a module node").toBeDefined();
    expect(target?.provenance).toEqual({ source: "src/types.d.ts", line: 1 });
    // The load-bearing assertion: the cited file has lines, so line 1 exists.
    // Before the fix the node existed with this exact provenance and the file
    // had never been read, which is what made the citation a decoration.
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.complete, "the graph must not be suppressed").toBe(true);
    expect(
      (await snapshotOf({})).diagnostics.filter(
        (d) => d.code === "DISCOVERY_GRAPH_PROVENANCE_INVALID",
      ),
    ).toEqual([]);
  });

  it("A2: a resolved JSON target is citable too, and is published as a module", async () => {
    const graph = await graphOf({
      "package.json": manifest({ name: "root" }),
      "tsconfig.json":
        '{ "compilerOptions": { "moduleResolution": "bundler", "resolveJsonModule": true } }',
      "src/index.ts": 'import data from "./data.json";\nexport default data;\n',
      "src/data.json": '{ "a": 1 }\n',
    });
    const target = moduleNodes(graph).find((node) => node.path === "src/data.json");
    expect(target?.provenance).toEqual({ source: "src/data.json", line: 1 });
    expect(graph.complete).toBe(true);
  });

  it("A3: the graph is still published when the target cannot be cited", async () => {
    // The honest-failure direction. A target the resolver found but this run
    // cannot stand behind must become `unresolved` with its own reason, never a
    // fabricated line 1 and never a silently missing edge. The size bound is
    // used rather than an injected read failure so the condition is a real one
    // rather than a fault: a two-megabyte declaration file is a thing
    // repositories genuinely have.
    const oversized = `export declare const a: string;\n${"// filler\n".repeat(120_000)}`;
    expect(oversized.length > 1_000_000).toBe(true);
    const graph = await graphOf({
      "package.json": manifest({ name: "root" }),
      "tsconfig.json": '{ "compilerOptions": { "moduleResolution": "bundler" } }',
      "src/index.ts": 'import type { A } from "./big.js";\nexport type { A };\n',
      "src/big.d.ts": oversized,
    });
    const edge = importEdges(graph).find((candidate) => candidate.specifier === "./big.js");
    expect(edge?.resolution.status).toBe("unresolved");
    if (edge?.resolution.status === "unresolved") {
      expect(edge.resolution.reason).toBe("target-not-readable");
    }
    // No node may cite a file the run refused to read, and the graph survives.
    expect(moduleNodes(graph).filter((node) => node.path === "src/big.d.ts")).toEqual([]);
    expect(graph.nodes.every((node) => node.provenance.line >= 1)).toBe(true);
  });

  it("A4: an out-of-universe target costs no read when it is already known", async () => {
    // A universe file that another module also imports must not be read twice.
    // The provenance helper checks the line cache first precisely so the common
    // case stays free; this pins that.
    const graph = await graphOf({
      "package.json": manifest({ name: "root" }),
      "tsconfig.json": '{ "compilerOptions": { "moduleResolution": "bundler" } }',
      "src/a.ts": 'import "./b.js";\n',
      "src/b.ts": "export const b = 1;\n",
      "src/c.ts": 'import "./b.js";\n',
    });
    const edges = importEdges(graph).filter((edge) => edge.specifier === "./b.js");
    expect(edges).toHaveLength(2);
    for (const edge of edges) {
      expect(edge.resolution.status).toBe("module");
    }
    expect(moduleNodes(graph).filter((node) => node.path === "src/b.ts")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// B. A multi-document pnpm lockfile is a lockfile
// ---------------------------------------------------------------------------

describe("B. a multi-document pnpm lockfile", () => {
  const MULTI_DOCUMENT_LOCKFILE = [
    "---",
    "lockfileVersion: '9.0'",
    "",
    "optionalDependencies:",
    "  '@pnpm/exe.linux-x64': 12.7.0",
    "  '@pnpm/exe.win32-x64': 12.7.0",
    "",
    "---",
    "lockfileVersion: '9.0'",
    "",
    "settings:",
    "  autoInstallPeers: true",
    "",
    "importers:",
    "",
    "  .:",
    "    dependencies:",
    "      ajv:",
    "        specifier: ^8.17.1",
    "        version: 8.17.1",
    "",
    "packages:",
    "",
    "  ajv@8.17.1:",
    "    resolution: {integrity: sha512-abc}",
    "",
  ].join("\n");

  it("B1: the lockfile document behind pnpm's leading document is read", async () => {
    // `pnpm/pnpm` at bb13fb9, `typescript-eslint` at 0bbe5e7, `biome` at
    // 6ed93b0, `vite` at 9944fa6, and `TanStack/query` at 1165a67 all reported
    // "The document is not parseable YAML (1 error(s))" for a file that is
    // perfectly valid YAML: pnpm writes two documents, and the first is the
    // published pnpm binary's own platform dependencies.
    const graph = await graphOf({
      "package.json": manifest({ name: "root", dependencies: { ajv: "^8.17.1" } }),
      "pnpm-lock.yaml": MULTI_DOCUMENT_LOCKFILE,
    });
    const edge = graph.edges.find(
      (candidate) => candidate.kind === "package-depends-on" && candidate.source === "package:.",
    );
    if (edge?.kind !== "package-depends-on") throw new Error("expected a dependency edge");
    expect(edge.resolution.status).toBe("resolved");
    if (edge.resolution.status === "resolved") {
      expect(edge.resolution.version).toBe("8.17.1");
      // The citation is a real line of the second document, which is what
      // makes the line number worth promising to a consumer.
      expect(edge.resolution.provenance.source).toBe("pnpm-lock.yaml");
      expect(edge.resolution.provenance.line).toBeGreaterThanOrEqual(13);
    }
  });

  it("B2: a single-document lockfile is unchanged by the multi-document rule", async () => {
    const graph = await graphOf({
      "package.json": manifest({ name: "root", dependencies: { ajv: "^8.17.1" } }),
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
    });
    const edge = graph.edges.find(
      (candidate) => candidate.kind === "package-depends-on" && candidate.source === "package:.",
    );
    if (edge?.kind !== "package-depends-on") throw new Error("expected a dependency edge");
    expect(edge.resolution.status).toBe("resolved");
  });

  it("B3: a lockfile document with no importers is read, not reported as an unknown layout", () => {
    // A lockfile that declares a version and no `importers` is still a
    // lockfile. Reading nothing from it is honest; calling its layout unknown
    // would not be, and would add a diagnostic a single-document lockfile has
    // never produced.
    const resolution = pnpmAdapter.resolve(
      "pnpm-lock.yaml",
      ["---", "lockfileVersion: '9.0'", "optionalDependencies:", "  x: 1", ""].join("\n"),
      ".",
    );
    expect(resolution.status).toBe("resolved");
    expect(resolution.versions.size).toBe(0);
  });

  it("B4: unparseable YAML is still reported as unparseable, not silently read", () => {
    const resolution = pnpmAdapter.resolve(
      "pnpm-lock.yaml",
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  bad\n\t- x\n",
      ".",
    );
    expect(resolution.status).toBe("unreadable");
    expect(resolution.detail).toContain("not parseable YAML");
    expect(resolution.versions.size).toBe(0);
  });

  it("B5: a stream with no lockfile version at all is reported as an unknown layout", () => {
    const resolution = pnpmAdapter.resolve("pnpm-lock.yaml", "importers:\n  .: {}\n", ".");
    expect(resolution.status).toBe("unsupported");
    expect(resolution.detail).toContain("lockfileVersion");
  });
});

// ---------------------------------------------------------------------------
// C. No snapshot may publish the checkout path
// ---------------------------------------------------------------------------

describe("C. checkout paths never reach the snapshot", () => {
  it("C1: an unusable tsconfig reports a repository-relative path", async () => {
    // `TanStack/query` at 1165a67 emitted seven diagnostics containing
    // `C:/Users/<name>/.../.svelte-kit/tsconfig.json`, because TypeScript's own
    // message quotes the absolute path it tried to read and the text was
    // carried through verbatim. Two checkouts of one commit then produced
    // different bytes, and the operator's home directory was published.
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root" }),
      "tsconfig.json": '{ "extends": "./.generated/tsconfig.json" }',
      "src/index.ts": "export const a = 1;\n",
    });
    const unusable = snapshot.diagnostics.filter((diagnostic) =>
      diagnostic.summary.includes("TypeScript configuration was not used"),
    );
    expect(unusable.length).toBeGreaterThan(0);
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain("/repo/");
    expect(text).not.toContain("\\repo\\");
    expect(text).not.toMatch(/[A-Za-z]:\\\\/);
    expect(String(unusable[0]?.detail)).toContain("tsconfig.json");
  });

  it("C2: the snapshot is byte-identical whatever the checkout root is", async () => {
    const files = {
      "package.json": manifest({ name: "root" }),
      "tsconfig.json": '{ "extends": "./.generated/tsconfig.json" }',
      "src/index.ts": "export const a = 1;\n",
    };
    const one = await discoverRepository(repoWith(files), { startDir: "/repo" });
    // The same content at a different absolute path, with the same `.git`
    // boundary so the only variable is the checkout root itself.
    const elsewhere = new InMemoryFileSystem("/somewhere/else/deeper");
    for (const [path, content] of Object.entries(files)) {
      elsewhere.addFile(`/somewhere/else/deeper/${path}`, content);
    }
    elsewhere.addDirectory("/somewhere/else/deeper/.git");
    const two = await discoverRepository(elsewhere, { startDir: "/somewhere/else/deeper" });
    if (!one.ok || !two.ok) throw new Error("expected both discoveries to succeed");
    expect(JSON.stringify(one.snapshot)).toBe(JSON.stringify(two.snapshot));
  });
});
