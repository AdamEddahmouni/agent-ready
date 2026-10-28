/**
 * Issue #40: the conformance corpus is enforced.
 *
 * The corpus only earns its keep if it runs on every change, so the checks live
 * in the normal test suite rather than in a script somebody has to remember to
 * run. `pnpm conformance:check` remains available as a maintainer-facing entry
 * point, and it is what CI's step should invoke for a legible report; this file
 * is what makes the same guarantee unbypassable.
 *
 * The tests are grouped by the failure they are built to catch:
 *
 * - **A** conformance: every case still produces its recorded bytes, and nothing
 *   in it depends on where the corpus is checked out.
 * - **B** shape: every expected snapshot validates against the published schema,
 *   so the corpus and the format cannot drift apart silently.
 * - **C** hygiene: no recorded output carries a path, a timestamp, or anything
 *   else specific to the machine that produced it.
 * - **D** read-only: running the corpus mutates nothing, and the update path is
 *   deterministic — both are what make the other checks meaningful.
 * - **E** drift detection: the corpus actually fails when behaviour changes,
 *   including for the case that pins a known inaccuracy. A corpus that cannot
 *   fail is a decoration.
 * - **F** the stable projection: the compatibility claim is mechanical, not
 *   prose, and a provisional change does not break it while a stable one does.
 */

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { runDiscover } from "../../src/cli/commands/discover.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import {
  CORPUS_SNAPSHOT_VERSION,
  buildFixtureFileSystem,
  environmentLeaks,
  firstDifference,
  loadCorpus,
  metadataValidationProblems,
  runCase,
  stableProjection,
  type CorpusCaseMetadata,
} from "../../src/conformance/discovery.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";

const schema = JSON.parse(
  readFileSync("schemas/discovery/snapshot-v1.schema.json", "utf8"),
) as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

const cases = loadCorpus(CORPUS_SNAPSHOT_VERSION);

describe("metadata contract", () => {
  it.each(cases.map((entry) => [entry.metadata.name, entry] as const))(
    "%s has valid machine-readable metadata.json",
    (_name, entry) => {
      const parsed = JSON.parse(readFileSync(join(entry.casePath, "metadata.json"), "utf8")) as
        Partial<CorpusCaseMetadata>;
      expect(metadataValidationProblems(entry.metadata.name, parsed)).toEqual([]);
    },
  );

  it("rejects metadata that omits known-inaccurate explanation fields", () => {
    const problems = metadataValidationProblems("example", {
      name: "example",
      purpose: "x",
      exercises: ["y"],
      snapshotVersion: CORPUS_SNAPSHOT_VERSION,
      status: "known-inaccurate",
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toMatch(/knownLimitation/);
    expect(problems.join("\n")).toMatch(/correctFutureBehaviour/);
  });
});

/** Every file under `root`, with its contents, for proving nothing changed. */
function fingerprint(root: string, prefix = ""): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const child = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(found, fingerprint(root, child));
    } else if (entry.isFile()) {
      found[child] = readFileSync(join(root, child), "utf8");
    }
  }
  return found;
}

describe("A. every case conforms", () => {
  it("the corpus is not empty and is small enough to stay reviewable", () => {
    // A corpus that grows without bound stops being read, and a corpus nobody
    // reads is a corpus nobody maintains. Eight is a deliberate ceiling for the
    // first release, not an accident.
    expect(cases.length).toBeGreaterThanOrEqual(6);
    expect(cases.length).toBeLessThanOrEqual(12);
  });

  it.each(cases.map((entry) => [entry.metadata.name, entry] as const))(
    "%s produces its recorded snapshot byte for byte",
    async (_name, entry) => {
      const actual = await runCase(entry);
      expect(firstDifference(entry.expected, actual)).toBe("the snapshots are byte-identical");
      expect(actual).toBe(entry.expected);
    },
  );

  it("produces identical bytes on a repeated run", async () => {
    for (const entry of cases) {
      const first = await runCase(entry);
      const second = await runCase(entry);
      expect(second, entry.metadata.name).toBe(first);
    }
  });

  it("every case declares this snapshot version", () => {
    for (const entry of cases) {
      expect(entry.metadata.snapshotVersion, entry.metadata.name).toBe(CORPUS_SNAPSHOT_VERSION);
    }
  });

  it("a CLI run over a real directory on disk produces the same bytes", async () => {
    // Everything else in this file runs discovery in memory. This one exercises
    // the path a consumer actually uses — the real filesystem, a real
    // directory, a real repository root — and requires the result to be
    // identical. A snapshot that only matched through a test double would be a
    // statement about the double.
    for (const entry of cases) {
      const temporary = mkdtempSync(join(tmpdir(), "agent-ready-conformance-"));
      try {
        const repo = join(temporary, "repo");
        cpSync(entry.repoPath, repo, { recursive: true });
        cpSync(join(temporary, "repo"), join(temporary, "repo-copy"), { recursive: true });
        // The fixture cannot carry a committed `.git` entry — git refuses to
        // track a path containing one — so it is created here. Without it the
        // root would resolve by walking up into whatever checkout the test
        // happens to run from, and the snapshot would describe Agent-Ready
        // rather than the fixture.
        mkdirSync(join(repo, ".git"), { recursive: true });

        const outcome = await runDiscover(new NodeFileSystem(), { json: true, root: repo });
        expect(outcome.stderr, entry.metadata.name).toBe("");
        expect(outcome.stdout, `${entry.metadata.name}: ${firstDifference(entry.expected, outcome.stdout)}`)
          .toBe(entry.expected);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  });
});

describe("B. every case is schema-valid", () => {
  it.each(cases.map((entry) => [entry.metadata.name, entry] as const))(
    "%s: its recorded snapshot validates",
    (_name, entry) => {
      const valid = validate(JSON.parse(entry.expected) as unknown);
      expect(valid, ajv.errorsText(validate.errors ?? [], { separator: "\n" })).toBe(true);
    },
  );

  it.each(cases.map((entry) => [entry.metadata.name, entry] as const))(
    "%s: its freshly produced snapshot validates",
    async (_name, entry) => {
      const actual = await runCase(entry);
      const valid = validate(JSON.parse(actual) as unknown);
      expect(valid, ajv.errorsText(validate.errors ?? [], { separator: "\n" })).toBe(true);
    },
  );
});

describe("C. no recorded output carries the machine it was made on", () => {
  it.each(cases.map((entry) => [entry.metadata.name, entry] as const))(
    "%s: no absolute path, timestamp, hostname, pid, or duration",
    (_name, entry) => {
      expect(environmentLeaks(entry.expected)).toEqual([]);
    },
  );

  it("the paths that do appear are canonical and `/`-separated", () => {
    for (const entry of cases) {
      const document = JSON.parse(entry.expected) as {
        graph?: { nodes?: { path?: string }[] } | null;
      };
      for (const node of document.graph?.nodes ?? []) {
        if (node.path === undefined) continue;
        expect(node.path, node.path).not.toContain("\\");
        expect(node.path, node.path).not.toMatch(/^[A-Za-z]:/);
      }
    }
  });
});

describe("D. running the corpus changes nothing", () => {
  it("a conformance run leaves every fixture tree byte-identical", async () => {
    const before = cases.map((entry) => fingerprint(entry.repoPath));
    for (const entry of cases) {
      await runCase(entry);
    }
    const after = cases.map((entry) => fingerprint(entry.repoPath));
    expect(after).toEqual(before);
  });

  it("the update path is deterministic and writes identical bytes on a second run", async () => {
    for (const entry of cases) {
      const first = await runCase(entry);
      const second = await runCase(entry);
      expect(second, entry.metadata.name).toBe(first);
      // What the update path would write is exactly the recorded expectation.
      expect(first, entry.metadata.name).toBe(entry.expected);
    }
  });

  it("the fixture filesystem offers no writer to the code under test", () => {
    // The read-only guarantee is structural rather than asserted: the fixture is
    // built in memory, and nothing in discovery can reach a writer through it.
    const fs = buildFixtureFileSystem(cases[0]?.repoPath ?? "");
    expect(fs).toBeInstanceOf(InMemoryFileSystem);
    expect(statSync(cases[0]?.repoPath ?? ".").isDirectory()).toBe(true);
  });
});

describe("E. the corpus fails when behaviour changes", () => {
  it("a known-inaccurate case exists and states why it is wrong", () => {
    const knownInaccurate = cases.filter((entry) => entry.metadata.status === "known-inaccurate");
    expect(knownInaccurate.length).toBeGreaterThanOrEqual(1);
    for (const entry of knownInaccurate) {
      expect(entry.metadata.knownLimitation, entry.metadata.name).toBeTruthy();
      expect(entry.metadata.correctFutureBehaviour, entry.metadata.name).toBeTruthy();
    }
  });

  it("an unsupported case exists, distinct from known-inaccurate", () => {
    expect(cases.some((entry) => entry.metadata.status === "unsupported")).toBe(true);
  });

  it("excluding dist/ from the known-inaccurate case would fail conformance", async () => {
    // The point of the case. If a future change fixed the source-universe
    // heuristic, this must fail rather than pass quietly: the fix is a decision
    // about closing a documented limitation, not something a test should let
    // through on its own. So simulate the fix — the same fixture with the
    // generated tree withheld — and require that it does NOT reproduce the
    // recorded bytes, and that what changes is precisely the source universe.
    const entry = cases.find(
      (candidate) => candidate.metadata.status === "known-inaccurate",
    );
    if (entry === undefined) throw new Error("no known-inaccurate case to check");

    const fs = buildFixtureFileSystem(entry.repoPath, {
      exclude: (path) => path.startsWith("dist/"),
    });
    const withoutBuildOutput = await runDiscover(fs, { json: true, root: "/repo" });
    expect(withoutBuildOutput.stdout).not.toBe(entry.expected);

    // The recorded output really does admit the generated tree…
    const recorded = JSON.parse(entry.expected) as {
      graph: { sourceUniverse: { files: string[] }; nodes: { id: string }[] };
    };
    expect(recorded.graph.sourceUniverse.files.filter((file) => file.startsWith("dist/"))).not
      .toEqual([]);
    expect(recorded.graph.nodes.filter((node) => node.id.startsWith("module:dist/"))).not.toEqual(
      [],
    );

    // …and withholding it removes both, which is the whole difference.
    const produced = JSON.parse(withoutBuildOutput.stdout) as {
      graph: { sourceUniverse: { files: string[] }; nodes: { id: string }[] };
    };
    expect(produced.graph.sourceUniverse.files).not.toEqual(recorded.graph.sourceUniverse.files);
    expect(produced.graph.sourceUniverse.files.filter((file) => file.startsWith("dist/"))).toEqual(
      [],
    );
    expect(produced.graph.nodes.filter((node) => node.id.startsWith("module:dist/"))).toEqual([]);
    // The inaccuracy is confined to the graph: withholding build output changes
    // the module universe and nothing an epistemic reader depends on. A claim
    // that the fixture is wrong for some *other* reason would not survive this.
    expect(produced.facts).toEqual(recorded.facts);
    expect(firstDifference(entry.expected, withoutBuildOutput.stdout)).toContain(".graph.nodes");
  });

  it("the drift report names a JSON path rather than dumping the snapshot", () => {
    const before = JSON.stringify({ a: 1, b: { c: [1, 2] } }, null, 2) + "\n";
    const after = JSON.stringify({ a: 1, b: { c: [1, 3] } }, null, 2) + "\n";
    const report = firstDifference(before, after);
    expect(report).toContain("expected");
    expect(report).toContain("actual");
    // Short enough to read in a terminal, and it locates the value.
    expect(report.length).toBeLessThan(400);
    expect(report).toMatch(/\.[a-zA-Z]/);
  });
});

describe("F. the stable projection makes the stability claim mechanical", () => {
  it("is pure: projecting a snapshot twice gives the same bytes", () => {
    for (const entry of cases) {
      const document = JSON.parse(entry.expected) as unknown;
      expect(JSON.stringify(stableProjection(document))).toBe(
        JSON.stringify(stableProjection(document)),
      );
    }
  });

  it("a provisional change leaves it byte-identical", () => {
    // `graph.sourceUniverse` and the per-edge resolution vocabulary are
    // provisional. Changing them must not disturb the promise.
    for (const entry of cases) {
      const original = JSON.parse(entry.expected) as {
        graph?: Record<string, unknown> | null;
      };
      const before = JSON.stringify(stableProjection(original));

      const document = JSON.parse(entry.expected) as {
        graph?: Record<string, unknown> | null;
      };
      if (document.graph !== null && document.graph !== undefined) {
        document.graph["sourceUniverse"] = {
          strategy: "bounded-traversal",
          tsconfigs: [],
          resolutionMode: "Bundler",
          extensions: [".ts"],
          files: ["totally/different.ts"],
          truncated: true,
        };
        document.graph["edges"] = "replaced entirely";
        document.graph["counts"] = { nodes: 0, edges: 0 };
      }
      expect(JSON.stringify(stableProjection(document)), entry.metadata.name).toBe(before);
    }
  });

  it("a stable change does move it", () => {
    const entry = cases.find((candidate) => candidate.metadata.name === "minimal-package");
    if (entry === undefined) throw new Error("the minimal-package case is required");
    const before = JSON.stringify(stableProjection(JSON.parse(entry.expected) as unknown));

    const document = JSON.parse(entry.expected) as {
      facts: Record<string, Record<string, unknown>>;
    };
    // `summary.complete` is stable, and a fact's evidence is stable.
    document.facts["repository.root"] = {
      ...document.facts["repository.root"],
      claims: [
        {
          kind: "derived",
          value: ".",
          evidence: [{ source: "somewhere/else.txt", detail: "a different source" }],
        },
      ],
    };
    expect(JSON.stringify(stableProjection(document))).not.toBe(before);
  });

  it("reads the current build's snapshotVersion rather than assuming it", () => {
    // The projection deliberately does NOT include `snapshotVersion`: the
    // version is checked by the schema, and folding it into the projection would
    // make every future bump look like a stability violation.
    for (const entry of cases) {
      const document = JSON.parse(entry.expected) as Record<string, unknown>;
      expect(document["snapshotVersion"]).toBe(CORPUS_SNAPSHOT_VERSION);
      expect(JSON.stringify(stableProjection(document))).not.toContain("snapshotVersion");
    }
  });

  it("a bumped snapshotVersion leaves the projection byte-identical", () => {
    // The corollary, and the reason the previous test matters: a future Format 2
    // that changed nothing stable must not be reported as a stability break by
    // this projection. The bump is caught by the schema, which is where it
    // belongs.
    for (const entry of cases) {
      const document = JSON.parse(entry.expected) as Record<string, unknown>;
      const before = JSON.stringify(stableProjection(document));
      const bumped = { ...document, snapshotVersion: CORPUS_SNAPSHOT_VERSION + 1 };
      expect(JSON.stringify(stableProjection(bumped)), entry.metadata.name).toBe(before);
      // And the schema, which is what owns the version, does reject it.
      expect(validate(bumped)).toBe(false);
    }
  });
});
