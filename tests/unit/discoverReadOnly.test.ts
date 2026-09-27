/**
 * The capability boundary and the probe protocol's own guarantees.
 *
 * Issue #36 proved these for a four-fact vocabulary that read a fixed set of
 * root-level paths. Issue #37 gave discovery a recursive walk, a second file
 * format, and a glob engine, so the boundary has to be re-proved rather than
 * assumed: a walk is exactly the kind of capability that turns a read-only
 * guarantee into a read-mostly one.
 */

import { describe, expect, it } from "vitest";
import { discoverRepository } from "../../src/discover/discover.js";
import { evidenceBudgetFor } from "../../src/discover/probe.js";
import type { DiscoveryProbe, ProbeResult } from "../../src/discover/probe.js";
import { isKnownFact } from "../../src/discover/types.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { manifest, RecordingFileSystem, repoWith, claimingValue } from "./discoverTestDoubles.js";

const SURFACE = "repository.declarationSurface.present";

const WORKSPACE_REPO = {
  "package.json": manifest({
    name: "root",
    packageManager: "pnpm@10.0.0",
    workspaces: ["packages/*"],
  }),
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "packages/a/package.json": manifest({ name: "a" }),
  "packages/b/package.json": manifest({ name: "b", packageManager: "npm@10.9.2" }),
  "packages/b/package-lock.json": manifest({ lockfileVersion: 3 }),
  "packages/docs/guide.md": "# guide\n",
  "node_modules/dep/package.json": manifest({ name: "installed-dependency" }),
  ".git/config": "[core]\n",
};

describe("discovery remains read-only, now that it walks the tree", () => {
  it("performs no write of any kind against a workspace repository", async () => {
    const fs = new RecordingFileSystem("/repo");
    for (const [path, content] of Object.entries(WORKSPACE_REPO)) {
      fs.addFile(`/repo/${path}`, content);
    }
    fs.addDirectory("/repo/.git");
    fs.addDirectory("/repo/packages/a");

    const result = await discoverRepository(fs, { startDir: "/repo" });
    expect(result.ok).toBe(true);

    // The counter is the assertion mechanism: there is no way to mutate without
    // one of these firing. A walk that created a directory to stat it, or
    // touched a lockfile it was reading, would show up here.
    expect(fs.mutatingCalls()).toEqual([]);
    // And it did real work, so the assertion above is not vacuous.
    expect(fs.calls.filter((call) => call.startsWith("read:"))).not.toHaveLength(0);
    expect(fs.calls.filter((call) => call.startsWith("listdir:"))).not.toHaveLength(0);
  });

  it("never reads a lockfile's contents, only its presence", async () => {
    // A lockfile is the largest file in most repositories. Reading it would make
    // discovery cost scale with install state, and nothing in the model needs
    // its contents: the artifact's existence is the whole observation.
    const fs = new RecordingFileSystem("/repo");
    for (const [path, content] of Object.entries(WORKSPACE_REPO)) {
      fs.addFile(`/repo/${path}`, content);
    }
    fs.addDirectory("/repo/.git");
    const result = await discoverRepository(fs, { startDir: "/repo" });
    expect(result.ok).toBe(true);
    // Every lockfile is only ever stat-ed, never read. The probe does look for
    // lockfiles beside each discovered manifest — a member's lockfile is evidence
    // about that member — so more than one `stat` is expected; a single `read`
    // of any lockfile is not.
    const lockfileCalls = fs.calls.filter((call) => call.includes("lock"));
    expect(lockfileCalls.filter((call) => call.startsWith("read:"))).toEqual([]);
    expect(lockfileCalls.every((call) => call.startsWith("stat:"))).toBe(true);
  });

  it("never enters node_modules or .git", async () => {
    // Both are excluded by convention, and entering `node_modules` would make
    // discovery cost scale with install state — so two checkouts of the same
    // commit would do different amounts of work to produce the same answer.
    const fs = new RecordingFileSystem("/repo");
    for (const [path, content] of Object.entries(WORKSPACE_REPO)) {
      fs.addFile(`/repo/${path}`, content);
    }
    fs.addDirectory("/repo/.git");
    fs.addDirectory("/repo/node_modules/dep");
    fs.addDirectory("/repo/node_modules/dep/node_modules");
    fs.addFile(
      "/repo/node_modules/dep/node_modules/transitive/package.json",
      manifest({ name: "t" }),
    );

    const result = await discoverRepository(fs, { startDir: "/repo" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fs.calls.filter((call) => call.includes("node_modules"))).toEqual([]);
    expect(fs.calls.filter((call) => call.includes("/.git"))).not.toContain("listdir:/repo/.git");
    // A dependency's manifest is not this repository's package.
    expect(JSON.stringify(result.snapshot)).not.toContain("installed-dependency");
  });

  it("stops at its depth and entry bounds, and says so rather than truncating silently", async () => {
    const files: Record<string, string> = {
      "package.json": manifest({ name: "deep", workspaces: ["**"] }),
    };
    // A chain far deeper than the walk's bound. Paths are built by joining, so
    // a leading separator cannot sneak in and create a directory whose name is
    // the empty string.
    const segments: string[] = [];
    for (let depth = 0; depth < 14; depth++) {
      segments.push(`d${String(depth)}`);
      files[`${segments.join("/")}/package.json`] = manifest({ name: `d${String(depth)}` });
    }
    const result = await discoverRepository(repoWith(files), { startDir: "/repo" });
    if (!result.ok) throw new Error("expected discovery to succeed");

    const truncated = result.snapshot.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "DISCOVERY_PARTIAL" && diagnostic.metadata?.["maxDepth"] !== undefined,
    );
    // The bound is reported, so a truncated candidate list can never be mistaken
    // for a complete one.
    expect(truncated).toBeDefined();
    expect(truncated?.metadata).toMatchObject({ maxDepth: 8 });
    // And the snapshot does not claim to be complete, because it is not.
    expect(result.snapshot.summary.complete).toBe(false);
    // The members within the bound are still found. A bound costs coverage, not
    // the whole result.
    const members = result.snapshot.facts["repository.workspace.members"];
    if (members?.kind === "unknown" || members === undefined || !("value" in members)) {
      throw new Error("expected members to be known");
    }
    expect((members.value as unknown[]).length).toBeGreaterThan(0);
  });

  it("does not report truncation for a repository shallower than the bound", async () => {
    // The bound costs nothing on an ordinary repository, so claiming truncation
    // would be a false alarm on nearly every project.
    const files: Record<string, string> = {
      "package.json": manifest({ name: "shallow", workspaces: ["packages/*"] }),
      "packages/a/package.json": manifest({ name: "a" }),
      "packages/b/package.json": manifest({ name: "b" }),
    };
    const result = await discoverRepository(repoWith(files), { startDir: "/repo" });
    if (!result.ok) throw new Error("expected discovery to succeed");
    expect(
      result.snapshot.diagnostics.some(
        (diagnostic) => diagnostic.metadata?.["maxDepth"] !== undefined,
      ),
    ).toBe(false);
    expect(result.snapshot.summary.complete).toBe(true);
  });
});

describe("the probe protocol's own guarantees", () => {
  it("caps how many paths one claim of each kind may cite", () => {
    // The budget is what stops a probe from inflating its own corroboration by
    // citing more paths, which the amended corroboration rule would otherwise
    // count as more support.
    expect(evidenceBudgetFor("declared")).toBe(1);
    expect(evidenceBudgetFor("author-declared")).toBe(1);
    // A derived claim may cite two: the lockfile that establishes *which* manager
    // and the manifest it was found beside. Still one assertion.
    expect(evidenceBudgetFor("derived")).toBe(2);
  });

  it("records nothing when a probe exceeds its evidence budget", async () => {
    const greedy: DiscoveryProbe = {
      id: "greedy",
      factId: SURFACE,
      kind: "derived",
      shape: "value",
      run: (): Promise<ProbeResult> =>
        Promise.resolve({
          status: "asserted",
          claims: [
            {
              factId: SURFACE,
              kind: "derived",
              value: "x",
              // Four paths from one inspection. Counting them as four sources
              // would manufacture corroboration out of a single look.
              evidence: [{ source: "a" }, { source: "b" }, { source: "c" }, { source: "d" }],
            },
          ],
        }),
    };
    const result = await discoverRepository(repoWith({}), {
      startDir: "/repo",
      probes: [greedy],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.snapshot.facts[SURFACE];
    // Nothing was recorded, rather than the claim being quietly accepted.
    expect(fact?.kind).toBe("unknown");
    expect(result.snapshot.diagnostics.some((d) => d.code === "DISCOVERY_PARTIAL")).toBe(true);
  });

  it("records nothing when one document is split into several claims", async () => {
    // Independence must not be manufactureable by re-reading the same field.
    // Each claim here cites one path, so every per-claim budget is satisfied —
    // which is exactly why the budget alone is not enough. Two claims from one
    // document would be reported as `corroborated: true`: a repository
    // apparently confirming itself out of a single read.
    const splitter: DiscoveryProbe = {
      id: "splitter",
      factId: SURFACE,
      kind: "declared",
      shape: "value",
      run: (): Promise<ProbeResult> =>
        Promise.resolve({
          status: "asserted",
          claims: [
            { factId: SURFACE, kind: "declared", value: "one", evidence: [{ source: "doc" }] },
            {
              factId: SURFACE,
              kind: "declared",
              value: "two",
              evidence: [{ source: "doc", pointer: "/other" }],
            },
          ],
        }),
    };
    const result = await discoverRepository(repoWith({}), {
      startDir: "/repo",
      probes: [splitter],
    });
    if (!result.ok) throw new Error("expected discovery to succeed");
    // Nothing was recorded, rather than the two claims being accepted as two
    // sources. A fact that cannot be shown to come from one inspection has not
    // established anything.
    const fact = result.snapshot.facts[SURFACE];
    expect(fact?.kind).toBe("unknown");
    expect(fact?.kind === "unknown" ? fact.reason : undefined).toBe("probe-failed");
    const diagnostic = result.snapshot.diagnostics.find(
      (candidate) => candidate.code === "DISCOVERY_PARTIAL",
    );
    expect(diagnostic?.detail).toContain("One document is one source");
  });

  it("still corroborates two claims from two different documents", async () => {
    // The refusal above is about one document, not about a second claim. Two
    // independent sources must still corroborate, or the rule would have
    // destroyed the signal it exists to protect.
    const honest: DiscoveryProbe = {
      id: "honest",
      factId: SURFACE,
      kind: "declared",
      shape: "value",
      run: (): Promise<ProbeResult> =>
        Promise.resolve({
          status: "asserted",
          claims: [
            { factId: SURFACE, kind: "declared", value: "one", evidence: [{ source: "a.json" }] },
            { factId: SURFACE, kind: "declared", value: "one", evidence: [{ source: "b.json" }] },
          ],
        }),
    };
    const result = await discoverRepository(repoWith({}), { startDir: "/repo", probes: [honest] });
    if (!result.ok) throw new Error("expected discovery to succeed");
    const fact = result.snapshot.facts[SURFACE];
    expect(fact).toMatchObject({ kind: "declared", value: "one" });
    if (fact === undefined || !isKnownFact(fact)) {
      throw new Error(`expected a known fact, got ${JSON.stringify(fact)}`);
    }
    expect(fact.corroboration.corroborated).toBe(true);
  });

  it("does not let an unknown identity's absence be reported as a value", async () => {
    const result = await discoverRepository(repoWith({}), {
      startDir: "/repo",
      probes: [claimingValue("says-one", SURFACE, "derived", "one", "a.json")],
    });
    if (!result.ok) throw new Error("expected discovery to succeed");
    expect(result.snapshot.facts[SURFACE]).toMatchObject({ kind: "derived", value: "one" });
  });
});

describe("every fact a snapshot reports can account for itself", () => {
  it("holds for every outcome in a workspace repository", async () => {
    const result = await discoverRepository(repoWith(WORKSPACE_REPO), { startDir: "/repo" });
    if (!result.ok) throw new Error("expected discovery to succeed");
    const snapshot = result.snapshot;
    for (const [id, fact] of Object.entries(snapshot.facts)) {
      if (fact.kind === "unknown") {
        // An unknown either records where it looked or was never probed. A
        // `probe-failed` fact with no evidence is the one legitimate exception:
        // failing to read something is precisely how nothing gets cited.
        expect(
          fact.evidence.length > 0 || fact.reason === "not-probed",
          `${id} is unknown and cannot say why`,
        ).toBe(true);
        continue;
      }
      // Every known fact cites at least one source for every claim it makes.
      expect(fact.claims.length, `${id} has no claims`).toBeGreaterThan(0);
      for (const claim of fact.claims) {
        expect(claim.evidence.length, `${id} has a claim with no evidence`).toBeGreaterThan(0);
        for (const item of claim.evidence) {
          // No absolute path and no parent traversal may appear in evidence: a
          // citation a consumer cannot resolve is not a citation.
          expect(item.source.startsWith("/"), `${id} cites an absolute path`).toBe(false);
          expect(item.source).not.toContain("..");
        }
      }
      // An incomplete fact always publishes a non-empty disagreement, so
      // "contested" is checkable from the shape.
      if ("contradictedBy" in fact && fact.contradictedBy !== undefined) {
        expect(fact.contradictedBy.length, `${id} is incomplete but names nothing`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("never leaks an absolute path into the snapshot for any repository shape", async () => {
    for (const root of ["/repo", "/home/someone/deeply/nested/checkout"]) {
      const fs = new InMemoryFileSystem(root);
      for (const [path, content] of Object.entries(WORKSPACE_REPO)) {
        fs.addFile(`${root}/${path}`, content);
      }
      fs.addDirectory(`${root}/.git`);
      const result = await discoverRepository(fs, { startDir: root });
      if (!result.ok) throw new Error("expected discovery to succeed");
      expect(JSON.stringify(result.snapshot), `leaked a path for ${root}`).not.toContain(root);
    }
  });
});
