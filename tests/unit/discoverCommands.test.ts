/**
 * Command and verification discovery: the adversarial matrix (ADR-0046).
 *
 * Structured as named cases rather than a list of assertions, because the point
 * of this suite is not that the code runs but that a *specific set of wrong
 * answers* is unreachable. Every case below is something a plausible
 * implementation would have got wrong:
 *
 *  - reading a script body to decide what a command does;
 *  - substring-matching `test` out of `contest`;
 *  - letting a lifecycle hook become an entrypoint;
 *  - defaulting the package manager to `npm`;
 *  - promoting a contested manager declaration to a canonical executable;
 *  - reporting an unreadable manifest's commands as empty;
 *  - letting a maintainer's contract change the repository's own facts.
 *
 * The role grammar is additionally tested directly against the table in
 * ADR-0046 §3, because it is the one place a small mistake would be invisible
 * in the snapshot and catastrophic in what a consumer believes.
 */

import { describe, expect, it } from "vitest";
import { discoverRepository } from "../../src/discover/discover.js";
import { roleForScriptName, knownCommandRoles } from "../../src/discover/commands/role.js";
import type { DiscoveryLayout } from "../../src/discover/probe.js";
import type { FileSystem } from "../../src/filesystem/types.js";
import type {
  DiscoverySnapshot,
  JsonValue,
  PackageCommandsEntry,
  VerificationEntrypointEntry,
} from "../../src/discover/types.js";
import { FACT_IDS } from "../../src/discover/types.js";
import {
  manifest,
  repoWith,
  repoWithReversedInsertion,
  repoAt,
  RecordingFileSystem,
} from "./discoverTestDoubles.js";

const COMMANDS = "repository.commands";
const ENTRYPOINTS = "repository.verificationEntrypoints";
const CONTRACT_VERIFICATION = "repository.contract.verification";

/** Every command declared by the package at `packagePath`, or undefined. */
function commandsOf(
  snapshot: DiscoverySnapshot,
  packagePath: string,
): PackageCommandsEntry | undefined {
  return packages(snapshot).find((entry) => entry.packagePath === packagePath);
}

/** The `scriptsStatus` of one package, for the absence-versus-failure cases. */
function statusOf(snapshot: DiscoverySnapshot, packagePath: string): string | undefined {
  return commandsOf(snapshot, packagePath)?.scriptsStatus;
}

function packages(snapshot: DiscoverySnapshot): readonly PackageCommandsEntry[] {
  return readCollection(snapshot, COMMANDS) as readonly PackageCommandsEntry[];
}

function entrypoints(snapshot: DiscoverySnapshot): readonly VerificationEntrypointEntry[] {
  return readCollection(snapshot, ENTRYPOINTS) as readonly VerificationEntrypointEntry[];
}

function entrypoint(
  snapshot: DiscoverySnapshot,
  packagePath: string,
  script: string,
): VerificationEntrypointEntry | undefined {
  return entrypoints(snapshot).find(
    (entry) => entry.packagePath === packagePath && entry.script === script,
  );
}

/** The role assigned to one script, or undefined when it has none. */
function roleOf(
  snapshot: DiscoverySnapshot,
  packagePath: string,
  script: string,
): string | undefined {
  return entrypoint(snapshot, packagePath, script)?.role;
}

/** The command names a package declares, in canonical order. */
function namesOf(snapshot: DiscoverySnapshot, packagePath: string): readonly string[] {
  return (commandsOf(snapshot, packagePath)?.commands ?? []).map((command) => command.name);
}

/**
 * Reads a collection fact's value.
 *
 * The snapshot is the canonical interface and this suite reads it the way a
 * consumer would, so a shape mismatch is a loud throw at one place rather than a
 * silent `undefined` read on every field below it.
 */
function readCollection(snapshot: DiscoverySnapshot, id: string): readonly JsonValue[] {
  const fact = snapshot.facts[id];
  if (fact === undefined || fact.kind === "unknown" || !("value" in fact)) {
    return [];
  }
  const value: JsonValue = fact.value;
  if (!Array.isArray(value)) {
    throw new Error(`${id} is not a collection.`);
  }
  return value as readonly JsonValue[];
}

async function snapshotOf(files: Parameters<typeof repoWith>[0]): Promise<DiscoverySnapshot> {
  const result = await discoverRepository(repoWith(files), { startDir: "/repo" });
  if (!result.ok) {
    throw new Error(`expected discovery to succeed: ${result.diagnostics[0]?.summary ?? ""}`);
  }
  return result.snapshot;
}

/** A repository with one root package declaring `scripts`, plus a pnpm lockfile. */
function singlePackage(
  scripts: unknown,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "package.json": manifest({ name: "root", packageManager: "pnpm@10.0.0", scripts }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// A. Root commands
// ---------------------------------------------------------------------------

describe("A. root commands are discovered with body and evidence", () => {
  it("A1: reports every declared script, its exact body, and its precise pointer", async () => {
    const snapshot = await snapshotOf(
      singlePackage({
        test: "vitest run",
        build: "node scripts/clean-dist.mjs && tsc -p tsconfig.build.json",
        "weird/name": "echo 'a/b'",
      }),
    );
    const commands = commandsOf(snapshot, ".")?.commands ?? [];
    expect(commands.map((command) => command.name)).toEqual(["build", "test", "weird/name"]);
    expect(commands.find((command) => command.name === "test")).toMatchObject({
      body: "vitest run",
      source: "package.json",
      pointer: "/scripts/test",
    });
  });

  it("A2: cites the manifest the commands came from", async () => {
    const snapshot = await snapshotOf(singlePackage({ test: "vitest run" }));
    const fact = snapshot.facts[COMMANDS];
    if (fact === undefined || fact.kind === "unknown" || !("value" in fact)) {
      throw new Error("expected a known command inventory");
    }
    expect(fact.claims[0]?.evidence.map((item) => item.source)).toContain("package.json");
  });

  it("A3: escapes a JSON Pointer for a script name containing `/` or `~`", async () => {
    // A script named `build/prod` is legal npm syntax. A pointer written without
    // escaping would resolve to a *different* location in the document, which is
    // worse than no pointer at all: precise-looking and wrong.
    const snapshot = await snapshotOf(
      singlePackage({ "build/prod": "vite build", "a~b": "echo hi" }),
    );
    const commands = commandsOf(snapshot, ".")?.commands ?? [];
    expect(commands.find((c) => c.name === "build/prod")?.pointer).toBe("/scripts/build~1prod");
    expect(commands.find((c) => c.name === "a~b")?.pointer).toBe("/scripts/a~0b");
  });
});

// ---------------------------------------------------------------------------
// B, C, D. Scoping, duplicates, and known-empty
// ---------------------------------------------------------------------------

const WORKSPACE = {
  "package.json": manifest({
    name: "root",
    packageManager: "pnpm@10.0.0",
    workspaces: ["packages/*"],
    scripts: { test: "vitest run", build: "vite build" },
  }),
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "packages/api/package.json": manifest({
    name: "api",
    scripts: { test: "jest", lint: "eslint ." },
  }),
  "packages/ui/package.json": manifest({ name: "ui", scripts: { build: "vite build" } }),
  "packages/plain/package.json": manifest({ name: "plain" }),
};

describe("B. workspace commands are scoped to the package that declares them", () => {
  it("B1: attributes each command to its declaring package", async () => {
    const snapshot = await snapshotOf(WORKSPACE);
    expect(namesOf(snapshot, ".")).toEqual(["build", "test"]);
    expect(namesOf(snapshot, "packages/api")).toEqual(["lint", "test"]);
    expect(namesOf(snapshot, "packages/ui")).toEqual(["build"]);
  });

  it("B2: cites the declaring package's manifest, not the root's", async () => {
    const snapshot = await snapshotOf(WORKSPACE);
    const apiTest = (commandsOf(snapshot, "packages/api")?.commands ?? []).find(
      (command) => command.name === "test",
    );
    expect(apiTest).toMatchObject({
      source: "packages/api/package.json",
      pointer: "/scripts/test",
    });
  });

  it("B3: runs a workspace command in the declaring package's directory", async () => {
    const snapshot = await snapshotOf(WORKSPACE);
    expect(entrypoint(snapshot, "packages/api", "test")?.invocation?.cwd).toBe("packages/api");
    expect(entrypoint(snapshot, ".", "test")?.invocation?.cwd).toBe(".");
  });
});

describe("C. duplicate names across packages are three declarations, not a conflict", () => {
  it("C1: a `test` in three packages produces three package-scoped commands", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({
        name: "root",
        packageManager: "pnpm@10.0.0",
        workspaces: ["packages/*"],
        scripts: { test: "vitest run" },
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/a/package.json": manifest({ name: "a", scripts: { test: "jest" } }),
      "packages/b/package.json": manifest({ name: "b", scripts: { test: "mocha" } }),
    });
    expect(entrypoints(snapshot).filter((entry) => entry.role === "test")).toHaveLength(3);
    expect(new Set(entrypoints(snapshot).map((entry) => entry.packagePath))).toEqual(
      new Set([".", "packages/a", "packages/b"]),
    );
    // The bodies stay distinct: the three were not deduplicated into one answer.
    expect(
      entrypoints(snapshot)
        .filter((entry) => entry.role === "test")
        .map((entry) => entry.body)
        .sort(),
    ).toEqual(["jest", "mocha", "vitest run"]);
    expect(snapshot.summary.conflicts).toBe(0);
  });
});

describe("D. a package with no scripts has a known-empty command set", () => {
  it("D1: reports `absent`, not unknown, and lists no commands", async () => {
    const snapshot = await snapshotOf(WORKSPACE);
    expect(statusOf(snapshot, "packages/plain")).toBe("absent");
    expect(namesOf(snapshot, "packages/plain")).toEqual([]);
  });

  it("D2: an empty scripts object is also known-empty, not unknown", async () => {
    const snapshot = await snapshotOf(singlePackage({}));
    expect(statusOf(snapshot, ".")).toBe("declared");
    expect(namesOf(snapshot, ".")).toEqual([]);
  });

  it("D3: a package with no recognised role is not claimed to have no tests", async () => {
    const snapshot = await snapshotOf(singlePackage({ whatever: "node scripts/thing.js" }));
    expect(namesOf(snapshot, ".")).toEqual(["whatever"]);
    expect(roleOf(snapshot, ".", "whatever")).toBeUndefined();
    // The inventory is a known, non-empty collection. Nothing anywhere says this
    // repository has no tests — only that no name matched the grammar.
    expect(snapshot.facts[COMMANDS]?.kind).toBe("declared");
  });
});

// ---------------------------------------------------------------------------
// E, F. Malformed and partially malformed scripts
// ---------------------------------------------------------------------------

describe("E. a malformed scripts field is unsupported, never coerced", () => {
  it("E1: a string-valued scripts is unsupported, not treated as one command", async () => {
    const snapshot = await snapshotOf(singlePackage("test"));
    expect(statusOf(snapshot, ".")).toBe("unsupported");
    expect(namesOf(snapshot, ".")).toEqual([]);
  });

  it("E2: an array-valued scripts is unsupported", async () => {
    const snapshot = await snapshotOf(singlePackage(["test", "build"]));
    expect(statusOf(snapshot, ".")).toBe("unsupported");
  });

  it("E3: a null-valued scripts is unsupported", async () => {
    const snapshot = await snapshotOf(singlePackage(null));
    expect(statusOf(snapshot, ".")).toBe("unsupported");
  });

  it("E4: an unsupported scripts raises the unmodelled-shape diagnostic, not a new code", async () => {
    const snapshot = await snapshotOf(singlePackage("test"));
    const codes = snapshot.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("DISCOVERY_FACT_UNSUPPORTED");
    // A code whose remediation would be identical to the existing one's is a
    // duplicate, not a new capability.
    expect(codes.filter((code) => code.startsWith("DISCOVERY_INVALID"))).toEqual([]);
  });
});

describe("F. one unusable entry does not delete the valid ones beside it", () => {
  it("F1: non-string values are retained as unmodelled; string values survive", async () => {
    const snapshot = await snapshotOf(
      singlePackage({ test: 42, build: null, lint: {}, typecheck: ["tsc"], real: "echo ok" }),
    );
    expect(statusOf(snapshot, ".")).toBe("declared");
    expect(namesOf(snapshot, ".")).toEqual(["real"]);
    const unmodelled = commandsOf(snapshot, ".")?.unmodelledScripts ?? [];
    expect(unmodelled.map((entry) => entry.name).sort()).toEqual([
      "build",
      "lint",
      "test",
      "typecheck",
    ]);
  });

  it("F2: never coerces a value with String()", async () => {
    const snapshot = await snapshotOf(singlePackage({ test: 42, build: null, lint: {} }));
    const unmodelled = commandsOf(snapshot, ".")?.unmodelledScripts ?? [];
    // `[object Object]` is the exact artefact this guards against, and `42` and
    // `null` as bodies would be claims the repository never made.
    const rendered = JSON.stringify(unmodelled);
    expect(rendered).not.toContain("[object Object]");
    expect(rendered).not.toContain('"body":"42"');
    expect(rmodelledLiteral(unmodelled, "build")).toBeNull();
  });

  it("F3: preserves the raw JSON value of an unmodelled entry", async () => {
    const snapshot = await snapshotOf(singlePackage({ a: 42, b: null, c: [1, 2] }));
    const unmodelled = commandsOf(snapshot, ".")?.unmodelledScripts ?? [];
    const byName = new Map(unmodelled.map((entry) => [entry.name, entry.value]));
    expect(byName.get("a")).toBe(42);
    expect(byName.get("b")).toBeNull();
    expect(byName.get("c")).toEqual([1, 2]);
  });

  it("F4: an empty-string body is a declared command, not an absent one", async () => {
    // A declared no-op is still a declaration. `if (!body)` would delete it.
    const snapshot = await snapshotOf(singlePackage({ noop: "", test: "vitest run" }));
    expect(namesOf(snapshot, ".")).toEqual(["noop", "test"]);
    expect(
      (commandsOf(snapshot, ".")?.commands ?? []).find((command) => command.name === "noop")?.body,
    ).toBe("");
  });
});

function rmodelledLiteral(
  entries: readonly { name: string; value: unknown }[],
  name: string,
): unknown {
  return entries.find((entry) => entry.name === name)?.value ?? null;
}

// ---------------------------------------------------------------------------
// G–O. The role grammar
// ---------------------------------------------------------------------------

describe("the role grammar matches ADR-0046 §3 exactly", () => {
  const EXACT: readonly (readonly [string, string])[] = [
    ["test", "test"],
    ["build", "build"],
    ["lint", "lint"],
    ["typecheck", "typecheck"],
  ];
  const NAMESPACED: readonly (readonly [string, string])[] = [
    ["test:unit", "test"],
    ["test:integration", "test"],
    ["test:snapshots:update", "test"],
    ["build:prod", "build"],
    ["build:production", "build"],
    ["lint:ci", "lint"],
    ["lint:fix", "lint"],
    ["typecheck:strict", "typecheck"],
  ];
  const UNCLASSIFIED: readonly string[] = [
    // Lifecycle hooks. Real declared scripts, and package-manager lifecycle
    // machinery Agent-Ready deliberately does not model (ADR-0046 §3).
    "pretest",
    "posttest",
    "prebuild",
    "postbuild",
    // Different words that merely contain a root.
    "contest",
    "testdata",
    "testing",
    "rebuild",
    "builder",
    "eslint",
    "linting",
    "buildup",
    // Not in the root set. An alias table would be a synonym dictionary that
    // grows by accretion, so none is supported.
    "types",
    "check:types",
    "type-check",
    "tsc",
    // Grammar edge cases.
    "test:",
    ":test",
    "TEST",
    "Test",
    "test unit",
    "test-unit",
    "a:b:c",
  ];

  it("G: an exact root name is its role, and is primary", () => {
    for (const [name, role] of EXACT) {
      expect(roleForScriptName(name), name).toEqual({ role, primary: true });
    }
  });

  it("H: a colon-namespaced name belongs to its root family, and is not primary", () => {
    for (const [name, role] of NAMESPACED) {
      expect(roleForScriptName(name), name).toEqual({ role, primary: false });
    }
  });

  it("I: `pretest` and `posttest` are not independent entrypoints", () => {
    for (const name of ["pretest", "posttest", "prebuild", "postbuild"]) {
      expect(roleForScriptName(name), name).toBeUndefined();
    }
  });

  it("J: a word that merely contains a root is not in that root's family", () => {
    for (const name of [
      "contest",
      "testdata",
      "testing",
      "rebuild",
      "builder",
      "eslint",
      "linting",
    ]) {
      expect(roleForScriptName(name), name).toBeUndefined();
    }
  });

  it("K: no alias is supported for the typecheck root", () => {
    for (const name of ["types", "check:types", "type-check", "typechecker"]) {
      expect(roleForScriptName(name), name).toBeUndefined();
    }
  });

  it("L: an empty or leading namespace separator does not match", () => {
    for (const name of ["test:", ":test", "build:", ""]) {
      expect(roleForScriptName(name), name).toBeUndefined();
    }
  });

  it("L2: every adversarial name in the table is unclassified, through discovery too", async () => {
    // The unit table above tests the grammar directly. This runs the same names
    // through the whole pipeline, because a role could in principle be attached
    // somewhere other than the classifier — and a role attached in the wrong
    // place would be a role nobody reviewed.
    const snapshot = await snapshotOf(
      singlePackage(Object.fromEntries(UNCLASSIFIED.map((name) => [name, "echo hi"]))),
    );
    expect(entrypoints(snapshot).map((entry) => entry.script)).toEqual([]);
    // Every one is still a known command with an exact body. Unclassified is not
    // the same as unknown, and this is where that distinction is pinned.
    expect(namesOf(snapshot, ".")).toEqual([...UNCLASSIFIED].sort());
  });

  it("M: one name yields at most one role — `test:build` is `test`, never both", () => {
    expect(roleForScriptName("test:build")).toEqual({ role: "test", primary: false });
    expect(roleForScriptName("build:test")).toEqual({ role: "build", primary: false });
  });

  it("N: the published vocabulary is exactly the four roots, and nothing else", () => {
    expect([...knownCommandRoles()].sort()).toEqual(["build", "lint", "test", "typecheck"]);
    // `verify` is deliberately refused: its meaning lives entirely in the body,
    // which is opaque, so a `verify` role would assert meaning rather than a name.
    expect(roleForScriptName("verify")).toBeUndefined();
    expect(roleForScriptName("verify:all")).toBeUndefined();
  });

  it("O: the grammar is case-sensitive and does not fold", () => {
    expect(roleForScriptName("TEST")).toBeUndefined();
    expect(roleForScriptName("Test")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// P–O continued. The snapshot applies the same grammar
// ---------------------------------------------------------------------------

describe("the snapshot classifies by name and never by body", () => {
  it("P: a body mentioning a test runner does not make an unrelated name a test", async () => {
    const snapshot = await snapshotOf(
      singlePackage({
        deploy: "vitest run",
        abc: "jest --coverage",
        ship: "npm test && deploy-production",
        bench: "node --test",
      }),
    );
    for (const name of ["deploy", "abc", "ship", "bench"]) {
      expect(roleOf(snapshot, ".", name), name).toBeUndefined();
    }
    // Every one of them is still a *known* command with its exact body.
    expect(namesOf(snapshot, ".")).toEqual(["abc", "bench", "deploy", "ship"]);
    expect(entrypoint(snapshot, ".", "deploy")).toBeUndefined();
  });

  it("Q: a body that is plainly not a test does not un-classify a `test` name", async () => {
    // The mirror of P. Classification is from the name in both directions, which
    // is what makes it a rule rather than a guess in either direction.
    const snapshot = await snapshotOf(
      singlePackage({
        test: "echo not-a-test-runner",
        build: "echo hello",
        lint: "node custom.js",
        typecheck: "true",
        deploy: "vitest run",
      }),
    );
    expect(roleOf(snapshot, ".", "test")).toBe("test");
    expect(roleOf(snapshot, ".", "build")).toBe("build");
    expect(roleOf(snapshot, ".", "lint")).toBe("lint");
    expect(roleOf(snapshot, ".", "typecheck")).toBe("typecheck");
    expect(roleOf(snapshot, ".", "deploy")).toBeUndefined();
  });

  it("R: the role grammar is the only source of a role — no tool names in logic", async () => {
    // A belt-and-braces check on the production classifier, complementing the
    // unit table above. If someone later adds a tool-name shortcut, this fails
    // even where the shortcut happens to agree with the grammar.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/discover/commands/role.ts", "utf8");
    // Comments are stripped first: this file's prose names `vitest` and `jest`
    // precisely to explain why they must not appear in the *logic*, and checking
    // the raw source would fail on the explanation of the rule.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const tool of [
      "vitest",
      "jest",
      "eslint",
      "tsc",
      "vite",
      "webpack",
      "rollup",
      "mocha",
      "ava",
      "node --test",
    ]) {
      expect(code, `role.ts logic references ${tool}`).not.toContain(tool);
    }
  });
});

describe("namespaced roles are distinguishable from the base name by identity, not rank", () => {
  it("S: `test` is primary and `test:unit` is not, when both exist", async () => {
    const snapshot = await snapshotOf(
      singlePackage({ test: "vitest run", "test:unit": "vitest run unit" }),
    );
    expect(entrypoint(snapshot, ".", "test")?.primary).toBe(true);
    expect(entrypoint(snapshot, ".", "test:unit")?.primary).toBe(false);
    expect(entrypoint(snapshot, ".", "test:unit")?.role).toBe("test");
  });

  it("T: with only namespaced variants, none is primary and all are reported", async () => {
    // Picking one would be the guess this issue exists to prevent.
    const snapshot = await snapshotOf(
      singlePackage({ "test:unit": "vitest run unit", "test:integration": "vitest run it" }),
    );
    const tests = entrypoints(snapshot).filter((entry) => entry.role === "test");
    expect(tests.map((entry) => entry.script).sort()).toEqual(["test:integration", "test:unit"]);
    expect(tests.every((entry) => !entry.primary)).toBe(true);
  });

  it("U: a namespaced entry keeps its declared name and body, not the role", async () => {
    const snapshot = await snapshotOf(singlePackage({ "test:update": "vitest run -u" }));
    const entry = entrypoint(snapshot, ".", "test:update");
    // The role is a projection. The declaration stays authoritative, so a
    // consumer can still see that this is `test:update` and what it runs.
    expect(entry).toMatchObject({ script: "test:update", role: "test", body: "vitest run -u" });
  });

  it("V: `lint:fix` is classified as lint without claiming it is non-mutating", async () => {
    const snapshot = await snapshotOf(
      singlePackage({ lint: "eslint .", "lint:fix": "eslint . --fix" }),
    );
    // The model makes no safety claim either way. `primary` distinguishes the
    // exact base name; it is not a suitability judgement.
    expect(entrypoint(snapshot, ".", "lint:fix")).toMatchObject({ role: "lint", primary: false });
    expect(entrypoint(snapshot, ".", "lint")).toMatchObject({ role: "lint", primary: true });
  });

  it("W: `build` is a distinct role from `test`, never collapsed into one verdict", async () => {
    const snapshot = await snapshotOf(singlePackage({ build: "vite build", test: "vitest run" }));
    expect(roleOf(snapshot, ".", "build")).toBe("build");
    expect(roleOf(snapshot, ".", "test")).toBe("test");
    expect(entrypoint(snapshot, ".", "build")?.invocation).not.toEqual(
      entrypoint(snapshot, ".", "test")?.invocation,
    );
  });
});

// ---------------------------------------------------------------------------
// Body opacity
// ---------------------------------------------------------------------------

describe("a command body is an opaque declared payload", () => {
  it("X: preserves a body exactly, including shell operators and spacing", async () => {
    const body = "  pnpm lint && pnpm test  ";
    const snapshot = await snapshotOf(singlePackage({ lint: body }));
    expect(commandsOf(snapshot, ".")?.commands[0]?.body).toBe(body);
  });

  it("X2: never splits a body on shell operators", async () => {
    const body = "npm test && npm run build || echo done";
    const snapshot = await snapshotOf(singlePackage({ test: body }));
    // One command, not four. Splitting would require modelling a shell, and the
    // split would be a claim about what the string meant.
    expect(namesOf(snapshot, ".")).toEqual(["test"]);
    expect(commandsOf(snapshot, ".")?.commands[0]?.body).toBe(body);
  });

  it("X3: never canonicalises an executable in a body", async () => {
    const snapshot = await snapshotOf(singlePackage({ test: "npx vitest run" }));
    expect(commandsOf(snapshot, ".")?.commands[0]?.body).toBe("npx vitest run");
  });
});

// ---------------------------------------------------------------------------
// P–U. Structured invocation
// ---------------------------------------------------------------------------

describe("structured invocation", () => {
  it("P: derives a structured invocation from an agreed root manager", async () => {
    const snapshot = await snapshotOf(singlePackage({ test: "vitest run" }));
    expect(entrypoint(snapshot, ".", "test")?.invocation).toEqual({
      cwd: ".",
      executable: "pnpm",
      args: ["run", "test"],
    });
    expect(entrypoint(snapshot, ".", "test")?.invocationStatus).toBe("resolved");
  });

  it("Q: uses `run <name>` uniformly, for every manager", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({
        name: "root",
        packageManager: "npm@10.9.2",
        scripts: { test: "tap" },
      }),
      "package-lock.json": manifest({ lockfileVersion: 3 }),
    });
    expect(entrypoint(snapshot, ".", "test")?.invocation).toEqual({
      cwd: ".",
      executable: "npm",
      args: ["run", "test"],
    });
  });

  it("R: a workspace member with no local manager inherits an agreed root manager", async () => {
    const snapshot = await snapshotOf(WORKSPACE);
    expect(entrypoint(snapshot, "packages/api", "test")?.invocation?.executable).toBe("pnpm");
  });

  it("S: a member's own agreed manager wins over the root's", async () => {
    // ADR-0045 §3's scoping rule, applied to invocation. `packages/legacy` must
    // not receive `pnpm run test` merely because the root was considered first.
    const snapshot = await snapshotOf({
      "package.json": manifest({
        name: "root",
        packageManager: "pnpm@10.0.0",
        workspaces: ["packages/*"],
        scripts: { test: "vitest run" },
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/legacy/package.json": manifest({
        name: "legacy",
        packageManager: "npm@10.9.2",
        scripts: { test: "tap" },
      }),
      "packages/legacy/package-lock.json": manifest({ lockfileVersion: 3 }),
    });
    expect(entrypoint(snapshot, ".", "test")?.invocation?.executable).toBe("pnpm");
    expect(entrypoint(snapshot, "packages/legacy", "test")?.invocation).toEqual({
      cwd: "packages/legacy",
      executable: "npm",
      args: ["run", "test"],
    });
  });

  it("T: an unknown manager leaves the invocation unresolved and never defaults to npm", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", scripts: { test: "vitest run" } }),
    });
    const entry = entrypoint(snapshot, ".", "test");
    expect(entry?.invocation).toBeNull();
    expect(entry?.invocationStatus).toBe("package-manager-unknown");
    // The script, its role, and its body are all still known. Only one field is
    // missing, and the rest of the answer survives it.
    expect(entry).toMatchObject({ role: "test", body: "vitest run", primary: true });
    expect(JSON.stringify(snapshot)).not.toContain('"executable":"npm"');
  });

  it("U: a conflicted manager selects no winner", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", scripts: { test: "vitest run" } }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "yarn.lock": "# yarn\n",
    });
    const entry = entrypoint(snapshot, ".", "test");
    expect(entry?.invocation).toBeNull();
    expect(entry?.invocationStatus).toBe("package-manager-conflict");
    // A conflict is still not an error: the command is fully known.
    expect(snapshot.summary.conflicts).toBe(1);
  });

  it("U2: a contested declaration never becomes a canonical executable", async () => {
    // `package.json` says pnpm, `package-lock.json` exists. ADR-0045 calls that
    // an *incomplete* fact: a declaration plus contradicting artifacts, with no
    // winner. Promoting the retained declaration to "the executable" would
    // resolve the disagreement by fiat.
    const snapshot = await snapshotOf({
      "package.json": manifest({
        name: "root",
        packageManager: "pnpm@10.0.0",
        scripts: { test: "vitest run" },
      }),
      "package-lock.json": manifest({ lockfileVersion: 3 }),
    });
    const entry = entrypoint(snapshot, ".", "test");
    expect(entry?.invocation).toBeNull();
    expect(entry?.invocationStatus).toBe("package-manager-incomplete");
    // The declaration survives in its own fact, with the contradiction published.
    const manager = snapshot.facts["repository.packageManager.root"];
    expect(manager).toMatchObject({ kind: "declared", contradictedBy: ["npm"] });
  });

  it("U3: a member with a contested manager does not inherit the root's", async () => {
    // Silence about a contradiction is not absence.
    const snapshot = await snapshotOf({
      "package.json": manifest({
        name: "root",
        packageManager: "pnpm@10.0.0",
        workspaces: ["packages/*"],
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/odd/package.json": manifest({
        name: "odd",
        packageManager: "pnpm@10.0.0",
        scripts: { test: "vitest run" },
      }),
      "packages/odd/package-lock.json": manifest({ lockfileVersion: 3 }),
    });
    expect(entrypoint(snapshot, "packages/odd", "test")?.invocation).toBeNull();
  });

  it("U4: a contract's package-manager claim never selects an executable", async () => {
    // A maintainer's description of the repository is not a statement by it.
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", scripts: { test: "vitest run" } }),
      "agent-ready.yaml": contractClaimingManager("pnpm"),
    });
    const entry = entrypoint(snapshot, ".", "test");
    expect(entry?.invocation).toBeNull();
    expect(entry?.invocationStatus).toBe("package-manager-unknown");
    expect(JSON.stringify(snapshot)).not.toContain('"executable":"pnpm"');
  });

  it("V: the invocation is repository-relative, never absolute", async () => {
    const snapshot = await snapshotOf(WORKSPACE);
    for (const entry of entrypoints(snapshot)) {
      const cwd = entry.invocation?.cwd;
      if (cwd !== undefined) {
        expect(cwd.startsWith("/")).toBe(false);
        expect(cwd).not.toMatch(/[A-Za-z]:\\/);
      }
    }
  });

  it("V2: an agreed manager derived from a lockfile alone is enough", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", scripts: { test: "vitest run" } }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });
    expect(entrypoint(snapshot, ".", "test")?.invocation?.executable).toBe("pnpm");
  });
});

function contractClaimingManager(name: string): string {
  return [
    "version: 1",
    "project:",
    "  name: fixture",
    "environment:",
    "  packageManager:",
    `    name: ${name}`,
    '    version: "10"',
    "commands: {}",
    "paths: {}",
    "adapters: {}",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Verification surfaces
// ---------------------------------------------------------------------------

describe("verification surfaces", () => {
  it("W: the four roles are represented distinctly", async () => {
    const snapshot = await snapshotOf(
      singlePackage({
        test: "vitest run",
        lint: "eslint .",
        typecheck: "tsc",
        build: "vite build",
      }),
    );
    const roles = entrypoints(snapshot)
      .map((entry) => entry.role)
      .sort();
    expect(roles).toEqual(["build", "lint", "test", "typecheck"]);
  });

  it("X: a package with no recognised scripts has a known-empty surface, not a claim about tests", async () => {
    const snapshot = await snapshotOf(singlePackage({ whatever: "true" }));
    const fact = snapshot.facts[ENTRYPOINTS];
    expect(fact?.kind).toBe("unknown");
    if (fact?.kind === "unknown") {
      expect(fact.reason).toBe("no-evidence");
    }
    // No diagnostic. Missing verification roles are a known absence, not a
    // problem with the repository, and discovery does not assign quality scores.
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("Y: a contract's verification sequence is published as author-declared", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", scripts: { test: "vitest run" } }),
      "agent-ready.yaml": contractWithVerification(["lint", "typecheck", "test"]),
    });
    const fact = snapshot.facts[CONTRACT_VERIFICATION];
    expect(fact?.kind).toBe("author-declared");
    expect(fact && "value" in fact ? fact.value : undefined).toEqual(["lint", "typecheck", "test"]);
    expect(fact && "claims" in fact ? fact.claims[0]?.evidence[0] : undefined).toMatchObject({
      source: "agent-ready.yaml",
      pointer: "/verification/required",
    });
  });

  it("Z: a contract claim and a missing package script both survive, and neither is an error", async () => {
    // The contract requires `test`; the package declares no `test`. Discovery
    // must not fabricate the script, must not drop the claim, and must not treat
    // the disagreement as a failure. That comparison is a later concern.
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", scripts: { build: "vite build" } }),
      "agent-ready.yaml": contractWithVerification(["test"]),
    });
    expect(namesOf(snapshot, ".")).toEqual(["build"]);
    expect(snapshot.facts[CONTRACT_VERIFICATION]).toMatchObject({
      kind: "author-declared",
      value: ["test"],
    });
    expect(snapshot.diagnostics).toEqual([]);
  });
});

function contractWithVerification(required: readonly string[]): string {
  const commands = required.map((name) => `  ${name}:\n    run: echo ${name}`).join("\n");
  return [
    "version: 1",
    "project:",
    "  name: fixture",
    "environment:",
    "  packageManager:",
    "    name: pnpm",
    '    version: "10"',
    "commands:",
    commands,
    "verification:",
    "  required:",
    ...required.map((name) => `    - ${name}`),
    "paths: {}",
    "adapters: {}",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// AA–AB. The contract does not change repository-derived facts
// ---------------------------------------------------------------------------

describe("a contract cannot change what the repository is", () => {
  it("AA: repository-derived command facts are byte-identical with and without a contract", async () => {
    const files = singlePackage({
      test: "vitest run",
      build: "vite build",
      lint: "eslint .",
      weird: "echo hi",
    });
    const without = await snapshotOf(files);
    const withContract = await snapshotOf({
      ...files,
      "agent-ready.yaml": contractWithVerification(["lint", "test", "does-not-exist"]),
    });
    // The equivalence the later benchmark depends on: a maintainer's
    // description must not change the model's account of the repository.
    expect(JSON.stringify(withContract.facts[COMMANDS])).toBe(
      JSON.stringify(without.facts[COMMANDS]),
    );
    expect(JSON.stringify(withContract.facts[ENTRYPOINTS])).toBe(
      JSON.stringify(without.facts[ENTRYPOINTS]),
    );
  });

  it("AB: an invalid contract leaves package command discovery intact", async () => {
    const files = singlePackage({ test: "vitest run" });
    const broken = await snapshotOf({
      ...files,
      "agent-ready.yaml": "version: [not, valid\n  yaml",
    });
    const absent = await snapshotOf(files);
    expect(JSON.stringify(broken.facts[COMMANDS])).toBe(JSON.stringify(absent.facts[COMMANDS]));
    expect(JSON.stringify(broken.facts[ENTRYPOINTS])).toBe(
      JSON.stringify(absent.facts[ENTRYPOINTS]),
    );
  });

  it("AB2: no contract is required at all", async () => {
    const snapshot = await snapshotOf(singlePackage({ test: "vitest run" }));
    expect(snapshot.ok).toBe(true);
    expect(snapshot.facts["repository.contract.present"]).toMatchObject({ value: false });
    expect(namesOf(snapshot, ".")).toEqual(["test"]);
  });
});

// ---------------------------------------------------------------------------
// AC. Failure localization
// ---------------------------------------------------------------------------

describe("failures stay local to the package that caused them", () => {
  it("AC: a malformed member manifest leaves its siblings' commands intact", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({
        name: "root",
        packageManager: "pnpm@10.0.0",
        workspaces: ["packages/*"],
        scripts: { test: "vitest run" },
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/broken/package.json": "{ this is not json",
      "packages/fine/package.json": manifest({ name: "fine", scripts: { test: "jest" } }),
    });
    expect(namesOf(snapshot, ".")).toEqual(["test"]);
    expect(namesOf(snapshot, "packages/fine")).toEqual(["test"]);
    // And the broken one is *reported*, not silently absent.
    expect(statusOf(snapshot, "packages/broken")).toBe("unobservable");
  });

  it("AC2: an unobservable command surface is never reported as empty", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", scripts: { test: "vitest run" } }),
    });
    const withBroken = await snapshotOf({
      "package.json": manifest({ name: "root", scripts: { test: "vitest run" } }),
      "packages/x/package.json": "{ broken",
      "pnpm-workspace.yaml": "packages:\n  - packages/x\n",
    });
    // The distinction is the point: a malformed manifest does not declare no
    // commands, it declares that its commands could not be established.
    expect(statusOf(withBroken, "packages/x")).toBe("unobservable");
    expect(namesOf(withBroken, "packages/x")).toEqual([]);
    expect(withBroken.summary.complete).toBe(false);
    // The root is unaffected either way.
    expect(namesOf(withBroken, ".")).toEqual(namesOf(snapshot, "."));
  });

  it("AC3: an unresolved invocation does not remove the command or its role", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", scripts: { test: "vitest run" } }),
      "yarn.lock": "# yarn\n",
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });
    expect(namesOf(snapshot, ".")).toEqual(["test"]);
    expect(roleOf(snapshot, ".", "test")).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// AD–AE. Determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("AD: identical content at two absolute roots produces byte-identical JSON", async () => {
    const files = WORKSPACE;
    const a = await discoverRepository(repoAt("/one/place", files), { startDir: "/one/place" });
    const b = await discoverRepository(repoAt("C:\\Users\\Someone\\else\\repo", files), {
      startDir: "C:\\Users\\Someone\\else\\repo",
    });
    if (!a.ok || !b.ok) {
      throw new Error("expected both discoveries to succeed");
    }
    expect(JSON.stringify(a.snapshot.facts)).toBe(JSON.stringify(b.snapshot.facts));
    expect(JSON.stringify(a.snapshot)).not.toContain("/one/place");
    expect(JSON.stringify(b.snapshot)).not.toContain("C:\\\\Users");
  });

  it("AE: filesystem insertion order is not observable", async () => {
    const ordered = await snapshotOf(WORKSPACE);
    const reversed = await discoverRepository(repoWithReversedInsertion(WORKSPACE), {
      startDir: "/repo",
    });
    if (!reversed.ok) {
      throw new Error("expected discovery to succeed");
    }
    expect(JSON.stringify(reversed.snapshot.facts)).toBe(JSON.stringify(ordered.facts));
  });

  it("AE2: entries and entrypoints are in code-unit order", async () => {
    const snapshot = await snapshotOf(
      singlePackage(
        { zebra: "a", alpha: "b", "test:z": "c", "test:a": "d" },
        {
          "packages/b/package.json": manifest({ name: "b", scripts: { test: "b" } }),
          "packages/a/package.json": manifest({ name: "a", scripts: { test: "a" } }),
        },
      ),
    );
    expect(namesOf(snapshot, ".")).toEqual(["alpha", "test:a", "test:z", "zebra"]);
    const order = entrypoints(snapshot).map((entry) => `${entry.packagePath}/${entry.script}`);
    expect(order).toEqual([...order].sort());
  });
});

// ---------------------------------------------------------------------------
// AF–AG. Capability boundary
// ---------------------------------------------------------------------------

describe("discovery gains no capability for commands", () => {
  it("AF/AG: a hostile script body is discovered but never executed", async () => {
    const fs = new RecordingFileSystem("/repo");
    fs.addFile(
      "/repo/package.json",
      manifest({
        name: "root",
        packageManager: "pnpm@10.0.0",
        scripts: {
          test: "node -e \"require('fs').writeFileSync('PWNED','1')\"",
          build: "touch SHOULD_NOT_EXIST && echo hi",
          deploy: "npm test && rm -rf /",
        },
      }),
    );
    fs.addFile("/repo/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    fs.addDirectory("/repo/.git");

    const result = await discoverRepository(fs, { startDir: "/repo" });
    if (!result.ok) {
      throw new Error("expected discovery to succeed");
    }
    const snapshot = result.snapshot;
    // Discovered, verbatim, inert.
    expect(namesOf(snapshot, ".")).toEqual(["build", "deploy", "test"]);
    expect(commandsOf(snapshot, ".")?.commands.find((c) => c.name === "test")?.body).toBe(
      "node -e \"require('fs').writeFileSync('PWNED','1')\"",
    );
    // Nothing ran, so nothing was written — and no process was ever available.
    expect(fs.mutatingCalls()).toEqual([]);
    expect(await fs.stat("/repo/PWNED")).toBeUndefined();
    expect(await fs.stat("/repo/SHOULD_NOT_EXIST")).toBeUndefined();
  });

  it("AF2: the probe context exposes no process runner of any kind", async () => {
    // The read-only guarantee is structural, not a convention: the interface a
    // probe receives has no member that could execute anything.
    const { createProbeContext } = await import("../../src/discover/context.js");
    const inertFileSystem: FileSystem = {
      cwd: "/repo",
      readTextFile: () => Promise.resolve(""),
      stat: () => Promise.resolve(undefined),
      listDirectory: () => Promise.resolve([]),
      realPath: (path: string) => Promise.resolve(path),
      writeTextFile: () => Promise.resolve(),
    };
    const emptyLayout = (): DiscoveryLayout => ({
      manifestPaths: [],
      packages: [],
      checkedDeclarationSources: [],
      declarations: [],
      candidates: [],
      truncated: false,
      unreadablePaths: [],
      workspaceRootManifest: null,
      brokenManifests: [],
      unmodelledPackageManagers: [],
      scripts: [],
    });
    const members = Object.keys(
      createProbeContext(
        inertFileSystem,
        "/repo",
        () => Promise.resolve({ status: "absent" as const }),
        () => Promise.resolve(undefined),
        () => Promise.resolve(undefined),
        () => Promise.resolve(emptyLayout()),
      ),
    );
    for (const forbidden of ["spawn", "exec", "shell", "run", "env", "fetch", "request"]) {
      expect(members, `context exposes ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("AF3: the production discovery sources contain no process execution", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.name.endsWith(".ts")) {
          files.push(path);
        }
      }
    };
    walk("src/discover");
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      for (const forbidden of [
        "node:child_process",
        "spawn(",
        "execSync",
        "eval(",
        "new Function(",
      ]) {
        expect(source, `${path} references ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AH. Summary semantics
// ---------------------------------------------------------------------------

describe("summary semantics", () => {
  it("AH: a repository with zero verification entrypoints is still complete", async () => {
    const snapshot = await snapshotOf(singlePackage({ whatever: "true" }));
    // Observed, and nothing was left unobserved. Zero recognised roles is
    // knowledge, not a coverage gap, and must not make `complete` false.
    expect(entrypoints(snapshot)).toEqual([]);
    expect(snapshot.summary.complete).toBe(true);
  });

  it("AH2: the new facts are counted once each, not once per command", async () => {
    const snapshot = await snapshotOf(WORKSPACE);
    const ids = Object.keys(snapshot.facts);
    expect(ids.filter((id) => id === COMMANDS)).toHaveLength(1);
    expect(ids.filter((id) => id === ENTRYPOINTS)).toHaveLength(1);
    expect(snapshot.summary.facts).toBe(ids.length);
  });

  it("AH3: snapshotVersion stays 0", async () => {
    const snapshot = await snapshotOf(singlePackage({ test: "vitest run" }));
    // ADR-0040's taxonomy and ADR-0045 §10: growth does not bump the version.
    expect(snapshot.snapshotVersion).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reuse of the existing contract fact vocabulary
// ---------------------------------------------------------------------------

describe("no duplicated declaration surface", () => {
  it("reuses repository.declarationSurface.present rather than a command-specific twin", () => {
    // Issue #36 already discovers the agent/declaration surface. #38 touches
    // verification, and the temptation is to publish a second, command-flavoured
    // version of the same fact; the vocabulary must not grow one.
    const ids = [...FACT_IDS];
    expect(ids).toContain("repository.declarationSurface.present");
    expect(ids.filter((id) => id.includes("declarationSurface"))).toHaveLength(1);
    // And the command facts are three conceptual properties, not one per script
    // or per role. An id generated from repository content cannot be reviewed,
    // which is the whole reason `FactId` is a finite union.
    expect(ids.filter((id) => /command|verification/i.test(id))).toEqual([
      "repository.commands",
      "repository.verificationEntrypoints",
      "repository.contract.verification",
    ]);
    expect(ids.some((id) => /^repository\.command\.(test|build|lint|typecheck)$/.test(id))).toBe(
      false,
    );
    // No id may carry a repository path or a role name; both are content.
    expect(ids.some((id) => id.includes("packages/"))).toBe(false);
    expect(ids.some((id) => /(^|\.)(test|build|lint|typecheck)\b/.test(id))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Human rendering
// ---------------------------------------------------------------------------

describe("human output never claims a command was executed", () => {
  async function humanOf(files: Parameters<typeof repoWith>[0]): Promise<string> {
    const { runDiscover } = await import("../../src/cli/commands/discover.js");
    const outcome = await runDiscover(repoWith(files), { json: false, root: "/repo" });
    return outcome.stdout;
  }

  it("renders a resolved invocation, scoped to the declaring package", async () => {
    const out = await humanOf(WORKSPACE);
    expect(out).toContain("pnpm run test");
    expect(out).toContain("cwd=packages/api · pnpm run test");
  });

  it("renders an unresolved invocation as unresolved, with no default executable", async () => {
    const out = await humanOf({
      "package.json": manifest({ name: "root", scripts: { test: "vitest run" } }),
    });
    expect(out).toContain("invocation unresolved");
    expect(out).toContain("package manager unknown");
    // The failure mode this guards: printing `npm run test` as a fallback.
    expect(out).not.toContain("npm run test");
    expect(out).not.toContain("[object Object]");
  });

  it("names the contested case rather than resolving it", async () => {
    const out = await humanOf({
      "package.json": manifest({
        name: "root",
        packageManager: "pnpm@10.0.0",
        scripts: { test: "vitest run" },
      }),
      "package-lock.json": manifest({ lockfileVersion: 3 }),
    });
    expect(out).toContain("package manager declaration contradicted");
    expect(out).not.toContain("pnpm run test");
  });

  it("uses declared/entrypoint language and never success language", async () => {
    const out = await humanOf(singlePackage({ test: "vitest run", build: "vite build" }));
    for (const forbidden of ["passed", "verified", "working", "succeeded", "green"]) {
      expect(out.toLowerCase(), `output says "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it("renders a package with no declared scripts as known-empty, not as broken", async () => {
    const out = await humanOf(WORKSPACE);
    expect(out).toContain("(no declared scripts)");
  });

  it("renders an unobservable command surface as unreadable, not empty", async () => {
    const out = await humanOf({
      "package.json": manifest({ name: "root", scripts: { test: "vitest run" } }),
      "pnpm-workspace.yaml": "packages:\n  - packages/x\n",
      "packages/x/package.json": "{ broken",
    });
    expect(out).toContain("(manifest could not be interpreted)");
  });

  it("labels the contract's list as author-declared, keeping it apart from findings", async () => {
    const out = await humanOf({
      "package.json": manifest({ name: "root", scripts: { test: "vitest run" } }),
      "agent-ready.yaml": contractWithVerification(["test"]),
    });
    expect(out).toContain("author-declared: test");
  });

  it("shows an unclassified script's body so the reader can judge it themselves", async () => {
    const out = await humanOf(singlePackage({ deploy: "vitest run" }));
    // The role column is a dash, not `test`. The body is shown, because hiding it
    // would make an honest "I did not classify this" look like a judgement.
    expect(out).toMatch(/deploy\s+—\s+vitest run/);
  });
});
