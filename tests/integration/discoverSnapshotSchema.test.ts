/**
 * Issue #40: Discovery Snapshot Format 1 is schema-valid.
 *
 * Two claims are being tested here and they are not the same claim.
 *
 * **Shape.** Every document `discover --json` can produce validates against the
 * published schema — not just a happy one, but the ones with an unknown fact, a
 * conflict, an incomplete fact, an unresolved import, a dependency with no
 * evidence, and an explicitly unowned subject. A schema that only describes a
 * clean repository is not a schema for this format.
 *
 * **Impossibility.** The TypeScript types already make several states
 * unrepresentable. The schema has to make the same states invalid for everyone
 * else, because a consumer that validates against a published artifact must get
 * the same protection a consumer of the library gets from the compiler. That is
 * what the negative half is for, and each fixture is a state the model says
 * cannot exist.
 *
 * The schema is loaded from disk rather than imported from `src`, on purpose: it
 * is a published artifact that a non-TypeScript consumer reads, so it must be
 * usable without the package.
 */

import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";
import { runDiscover } from "../../src/cli/commands/discover.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { manifest } from "../unit/discoverTestDoubles.js";

const SCHEMA_PATH = "schemas/discovery/snapshot-v1.schema.json";
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate: ValidateFunction = ajv.compile(schema);

function paths(): string {
  return ajv.errorsText(validate.errors ?? [], { separator: "\n" });
}

/**
 * One graph node from a fixture, with a guard rather than an assertion.
 *
 * The negative cases below mutate a node in place, and the project forbids
 * non-null assertions — so the "this index exists" check lives here, once,
 * instead of being re-asserted at every call site.
 */
function nodeAt(document: Record<string, unknown>, index: number): Record<string, unknown> {
  const graph = document["graph"];
  if (typeof graph !== "object" || graph === null) {
    throw new Error("the fixture has no graph");
  }
  const nodes = (graph as Record<string, unknown>)["nodes"];
  if (!Array.isArray(nodes)) {
    throw new Error("the fixture has no graph nodes");
  }
  const node: unknown = nodes[index];
  if (typeof node !== "object" || node === null) {
    throw new Error(`the fixture has no node at index ${String(index)}`);
  }
  return node as Record<string, unknown>;
}

describe("the published schema compiles", () => {
  it("compiles under Ajv's strict mode", () => {
    // `strict: true` rejects an unknown keyword, a missing type, and a
    // `$ref` that does not resolve. A schema that only compiles with strictness
    // switched off is a schema whose author was not reading it.
    expect(typeof validate).toBe("function");
  });

  it("is its own version: a document declaring any other snapshotVersion is rejected", () => {
    for (const version of [0, 2, "1", null]) {
      const document = validDocument();
      document["snapshotVersion"] = version;
      expect(validate(document), paths()).toBe(false);
    }
  });

  it("lives outside the frozen contract schema namespace", () => {
    const contract = JSON.parse(readFileSync("schemas/v1/agent-ready.schema.json", "utf8")) as {
      $id: string;
    };
    const id = (schema as { $id: string }).$id;
    expect(id).not.toBe(contract.$id);
    expect(id).toContain("discovery/snapshot-v1");
  });
});

describe("real output validates", () => {
  it("validates the CLI's own stdout for a repository with everything in it", async () => {
    const fs = new InMemoryFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile(
      "/repo/package.json",
      manifest({
        name: "root",
        packageManager: "pnpm@10.0.0",
        scripts: { test: "vitest run", build: "tsc -b" },
        dependencies: { ajv: "^8.17.1" },
      }),
    );
    fs.addFile(
      "/repo/pnpm-lock.yaml",
      [
        "lockfileVersion: '9.0'",
        "importers:",
        "  .:",
        "    dependencies:",
        "      ajv:",
        "        specifier: ^8.17.1",
        "        version: 8.17.1",
        "",
      ].join("\n"),
    );
    fs.addFile("/repo/tsconfig.json", '{ "compilerOptions": { "moduleResolution": "nodenext" } }');
    fs.addFile("/repo/.github/CODEOWNERS", "* @org/platform\n");
    fs.addFile("/repo/src/index.ts", 'import { helper } from "./helper.js";\nexport { helper };\n');
    fs.addFile("/repo/src/helper.ts", "export const helper = 1;\n");

    const outcome = await runDiscover(fs, { json: true, root: "/repo" });
    expect(outcome.exitCode).toBe(0);
    const document = JSON.parse(outcome.stdout) as Record<string, unknown>;
    expect(validate(document), paths()).toBe(true);
    expect(document["snapshotVersion"]).toBe(1);
  });

  it("validates a snapshot with no graph at all", async () => {
    const fs = new InMemoryFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/AGENTS.md", "# agents\n");
    const outcome = await runDiscover(fs, { json: true, root: "/repo" });
    const document = JSON.parse(outcome.stdout) as Record<string, unknown>;
    expect(validate(document), paths()).toBe(true);
  });

  it("validates every epistemic shape a repository can produce", () => {
    // One document containing all four fact shapes at once, assembled by hand
    // because no single small repository produces all of them.
    const document = validDocument();
    const facts = document["facts"] as Record<string, unknown>;
    facts["repository.root"] = unknownFact("repository.root", "no-evidence");
    facts["repository.contract.present"] = agreedFact("repository.contract.present", false);
    facts["repository.contract.valid"] = conflictedFact("repository.contract.valid");
    facts["repository.contract.verification"] = incompleteFact("repository.contract.verification");
    const graph = document["graph"] as Record<string, unknown>;
    graph["edges"] = [
      importEdge({ status: "unresolved", reason: "target-not-found" }),
      importEdge({ status: "platform" }),
      importEdge({ status: "module", target: "module:src/helper.ts", targetPath: "src/helper.ts" }),
      {
        id: "dependency:package:.:dependency:ajv",
        kind: "package-depends-on",
        source: "package:.",
        target: "dependency:ajv",
        declarations: [
          {
            name: "ajv",
            dependencyClass: "runtime",
            declaredSpecifier: "^8.17.1",
            provenance: { source: "package.json", line: 3, column: 3 },
            pointer: "/dependencies/ajv",
          },
        ],
        resolution: { status: "no-evidence" },
        provenance: { source: "package.json", line: 3, column: 3 },
        targetMissing: false,
      },
      {
        id: "ownership:module:src/helper.ts->owner:@org/platform",
        kind: "owned-by",
        source: "module:src/helper.ts",
        target: "owner:@org/platform",
        provenance: { source: ".github/CODEOWNERS", line: 1 },
        rule: "*",
      },
    ];
    const counts = graph["counts"] as Record<string, number>;
    counts["importEdges"] = 3;
    counts["unresolvedImports"] = 1;
    counts["resolvedImports"] = 2;
    counts["dependencyEdges"] = 1;
    counts["ownedSubjects"] = 2;
    counts["unownedSubjects"] = 0;
    expect(validate(document), paths()).toBe(true);
  });

  it("validates a snapshot whose graph is null", () => {
    const document = validDocument();
    document["graph"] = null;
    expect(validate(document), paths()).toBe(true);
  });

  it("validates a fact value of every JSON shape", () => {
    const document = validDocument();
    const facts = document["facts"] as Record<string, unknown>;
    for (const value of [null, 1, "s", true, [1, "two"], { a: [1] }]) {
      facts["repository.root"] = agreedFact("repository.root", value);
      expect(validate(document), paths()).toBe(true);
    }
  });
});

describe("impossible states are rejected", () => {
  it("rejects an unknown fact that carries a value", () => {
    const document = validDocument();
    const fact: Record<string, unknown> = unknownFact("repository.root", "no-evidence");
    fact["value"] = ".";
    (document["facts"] as Record<string, unknown>)["repository.root"] = fact;
    expect(validate(document), paths()).toBe(false);
  });

  it("cannot distinguish a conflicted fact that carries a value from an agreed one", () => {
    // The four epistemic shapes are discriminated by which fields are present,
    // not by a status tag. The fact below carries two disagreeing claims;
    // adding `value` therefore produces a document that is structurally an
    // agreed fact with two claims. JSON Schema cannot express "these values are
    // unequal", so the state is representable and remains a semantic invariant
    // enforced by the merge in `fact.ts`. Rejecting it here would need a
    // discriminator field, which is a format change rather than a test fix.
    const document = validDocument();
    const fact: Record<string, unknown> = conflictedFact("repository.root");
    fact["value"] = "a";
    (document["facts"] as Record<string, unknown>)["repository.root"] = fact;
    expect(validate(document), paths()).toBe(true);
  });

  it("rejects a known fact whose claim cites nothing", () => {
    const document = validDocument();
    const fact: Record<string, unknown> = agreedFact("repository.root", ".");
    (fact["claims"] as Record<string, unknown>[])[0] = {
      kind: "derived",
      value: ".",
      evidence: [],
    };
    (document["facts"] as Record<string, unknown>)["repository.root"] = fact;
    expect(validate(document), paths()).toBe(false);
  });

  it("rejects a fact with no claims at all", () => {
    const document = validDocument();
    const fact: Record<string, unknown> = agreedFact("repository.root", ".");
    fact["claims"] = [];
    (document["facts"] as Record<string, unknown>)["repository.root"] = fact;
    expect(validate(document), paths()).toBe(false);
  });

  it("rejects an incomplete fact with nothing it disagrees with", () => {
    const document = validDocument();
    const fact: Record<string, unknown> = incompleteFact("repository.root");
    fact["contradictedBy"] = [];
    (document["facts"] as Record<string, unknown>)["repository.root"] = fact;
    expect(validate(document), paths()).toBe(false);
  });

  it("rejects a valueless fact that claims to be contradicted by something", () => {
    // An incomplete fact carries BOTH a value and `contradictedBy`, so a fact
    // with no value cannot be incomplete. That is checkable from the shape.
    //
    // The converse is deliberately not tested here: a fact that carries a value
    // whose claims happen to disagree is structurally an agreed fact, and JSON
    // Schema cannot say that two `value`s are unequal. That is a semantic
    // invariant, enforced by the merge in `fact.ts` rather than by this
    // document, and claiming otherwise would be a test that passes for the
    // wrong reason.
    const document = validDocument();
    const fact: Record<string, unknown> = conflictedFact("repository.root");
    fact["contradictedBy"] = ["something"];
    (document["facts"] as Record<string, unknown>)["repository.root"] = fact;
    expect(validate(document), paths()).toBe(false);
  });

  it("rejects a fact id that is not in the vocabulary", () => {
    const document = validDocument();
    (document["facts"] as Record<string, unknown>)["repository.weather.today"] = agreedFact(
      "repository.root",
      true,
    );
    expect(validate(document), paths()).toBe(false);
  });

  it("rejects an absolute provenance path", () => {
    const document = validDocument();
    nodeAt(document, 0)["provenance"] = {
      source: "C:/Users/someone/repo/src/index.ts",
      line: 1,
    };
    expect(validate(document), paths()).toBe(false);
  });

  it("rejects a path that escapes the repository", () => {
    for (const source of ["../outside.ts", "/etc/passwd", "./here.ts"]) {
      const document = validDocument();
      nodeAt(document, 0)["provenance"] = { source, line: 1 };
      expect(validate(document), `${source}: ${paths()}`).toBe(false);
    }
  });

  it("rejects a provenance line that is not 1-based", () => {
    for (const line of [0, -1, 1.5, "1"]) {
      const document = validDocument();
      nodeAt(document, 0)["provenance"] = { source: "src/index.ts", line };
      expect(validate(document), `line ${String(line)}: ${paths()}`).toBe(false);
    }
  });

  it("rejects a resolved import edge with no target", () => {
    const document = validDocument();
    const graph = document["graph"] as Record<string, unknown>;
    graph["edges"] = [importEdge({ status: "module", targetPath: "src/helper.ts" })];
    expect(validate(document), paths()).toBe(false);
  });

  it("rejects an unresolved import edge that carries a target", () => {
    const document = validDocument();
    const graph = document["graph"] as Record<string, unknown>;
    graph["edges"] = [
      importEdge({ status: "unresolved", reason: "target-not-found", target: "module:src/x.ts" }),
    ];
    expect(validate(document), paths()).toBe(false);
  });

  it("rejects an unowned subject that carries owners", () => {
    const document = validDocument();
    nodeAt(document, 1)["ownership"] = {
      status: "unowned",
      policy: { status: "absent", source: null },
      ownerIds: ["owner:@org/platform"],
    };
    expect(validate(document), paths()).toBe(false);
  });

  it("rejects an owned subject with an empty owner list", () => {
    const document = validDocument();
    nodeAt(document, 1)["ownership"] = {
      status: "owned",
      ownerIds: [],
    };
    expect(validate(document), paths()).toBe(false);
  });

  it("rejects a package entry whose name contradicts its nameStatus", () => {
    // The model says `name` is null unless `nameStatus` is `declared`. The
    // schema does not second-guess that, because the fact carries its own
    // evidence; what it does forbid is a *type* that cannot be the model's.
    const document = validDocument();
    const facts = document["facts"] as Record<string, unknown>;
    const fact = agreedFact("repository.packages", [
      {
        path: ".",
        name: 42,
        nameStatus: "declared",
        private: null,
        version: null,
        manifestStatus: "read",
      },
    ]);
    facts["repository.packages"] = fact;
    expect(validate(document), paths()).toBe(false);
  });

  it("rejects a diagnostics entry that is not a DISCOVERY code", () => {
    const document = validDocument();
    (document["diagnostics"] as Record<string, unknown>[])[0] = {
      code: "CONTRACT_SCHEMA_INVALID",
      severity: "error",
      summary: "not a discovery code",
    };
    expect(validate(document), paths()).toBe(false);
  });

  it("rejects an unknown property on a stable object", () => {
    const document = validDocument();
    document["extraField"] = true;
    expect(validate(document), paths()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal document that is valid, for the negative cases to mutate. */
function validDocument(): Record<string, unknown> {
  return {
    ok: true,
    snapshotVersion: 1,
    root: ".",
    facts: {
      "repository.root": agreedFact("repository.root", "."),
      "repository.commands": agreedFact("repository.commands", [
        {
          packagePath: ".",
          scriptsStatus: "declared",
          commands: [
            { name: "test", body: "vitest run", source: "package.json", pointer: "/scripts/test" },
          ],
          unmodelledScripts: [],
          unsupportedReason: null,
        },
      ]),
      "repository.verificationEntrypoints": agreedFact("repository.verificationEntrypoints", [
        {
          packagePath: ".",
          script: "test",
          role: "test",
          body: "vitest run",
          primary: true,
          invocation: { cwd: ".", executable: "npm", args: ["test"] },
          invocationStatus: "resolved",
          source: "package.json",
          pointer: "/scripts/test",
        },
      ]),
    },
    graph: {
      nodes: [
        {
          id: "package:.",
          kind: "package",
          path: ".",
          name: "root",
          provenance: { source: "package.json", line: 2, column: 3 },
          ownership: { status: "unowned", policy: { status: "absent", source: null } },
        },
        {
          id: "module:src/index.ts",
          kind: "module",
          path: "src/index.ts",
          packagePath: ".",
          provenance: { source: "src/index.ts", line: 1 },
          ownership: { status: "owned", ownerIds: ["owner:@org/platform"] },
        },
        {
          id: "owner:@org/platform",
          kind: "owner",
          identity: "@org/platform",
          provenance: { source: ".github/CODEOWNERS", line: 1 },
        },
      ],
      edges: [],
      sourceUniverse: {
        strategy: "tsconfig",
        tsconfigs: ["tsconfig.json"],
        resolutionMode: "NodeNext",
        extensions: [".ts"],
        files: ["src/index.ts"],
        truncated: false,
      },
      ownership: {
        status: "present",
        source: ".github/CODEOWNERS",
        rules: 1,
        unsupportedPatterns: [],
        detail: null,
      },
      counts: {
        nodes: 3,
        edges: 0,
        packages: 1,
        modules: 1,
        externalDependencies: 0,
        owners: 1,
        importEdges: 0,
        resolvedImports: 0,
        unresolvedImports: 0,
        dependencyEdges: 0,
        resolvedDependencies: 0,
        workspaceDependencies: 0,
        ownedSubjects: 1,
        unownedSubjects: 1,
      },
      complete: true,
      truncatedBy: null,
    },
    summary: { facts: 3, known: 3, unknown: 0, conflicts: 0, complete: true },
    diagnostics: [
      {
        code: "DISCOVERY_PARTIAL",
        severity: "warning",
        summary: "something was not established",
        metadata: { anything: ["goes", 1, null] },
      },
    ],
  };
}

function agreedFact(id: string, value: unknown): Record<string, unknown> {
  return {
    id,
    kind: "derived",
    value,
    claims: [
      {
        kind: "derived",
        value,
        evidence: [{ source: "package.json", pointer: "/name" }],
      },
    ],
    corroboration: { kinds: ["derived"], authorDeclared: false, corroborated: false },
  };
}

function unknownFact(id: string, reason: string): Record<string, unknown> {
  return { id, kind: "unknown", reason, evidence: [{ source: "package.json", detail: "looked" }] };
}

function conflictedFact(id: string): Record<string, unknown> {
  return {
    id,
    kind: "declared",
    claims: [
      { kind: "declared", value: "a", evidence: [{ source: "package.json" }] },
      { kind: "derived", value: "b", evidence: [{ source: "package-lock.json" }] },
    ],
    corroboration: {
      kinds: ["declared", "derived"],
      authorDeclared: false,
      corroborated: true,
    },
  };
}

function incompleteFact(id: string): Record<string, unknown> {
  return {
    id,
    kind: "declared",
    value: "pnpm@10.0.0",
    claims: [
      {
        kind: "declared",
        value: "pnpm@10.0.0",
        evidence: [{ source: "package.json", pointer: "/packageManager" }],
      },
      { kind: "derived", value: "package-lock.json", evidence: [{ source: "package-lock.json" }] },
    ],
    contradictedBy: ["npm"],
    corroboration: {
      kinds: ["declared", "derived"],
      authorDeclared: false,
      corroborated: true,
    },
  };
}

function importEdge(resolution: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "import:module:src/index.ts->module:src/helper.ts@1:1",
    kind: "imports",
    source: "module:src/index.ts",
    specifier: "./helper.js",
    syntax: "import",
    typeOnly: false,
    resolution,
    provenance: { source: "src/index.ts", line: 1, column: 25 },
  };
}
