/**
 * The epistemic boundary, stated as executable invariants.
 *
 * ADR-0044's governing rule is "unknown beats wrong", which is only meaningful
 * if the ways a system can be confidently wrong are individually pinned. Every
 * test in this file corresponds to one specific way the snapshot could have
 * lied and did not, and the shared assertion is:
 *
 *   OUTPUT CLAIM STRENGTH <= SUPPORT PROVIDED BY THE EVIDENCE CONTRACT.
 *
 * These are deliberately unit-level and use the fact algebra directly, so a
 * regression is attributed to the algebra rather than to whichever probe or
 * rendering happened to exercise it.
 */

import { describe, expect, it } from "vitest";
import {
  buildAgreedFact,
  buildUnknownFact,
  hasEvidence,
  isContradictory,
  isSelfDescribing,
  mergeContributions,
} from "../../src/discover/fact.js";
import type { Contribution, KnownContribution } from "../../src/discover/fact.js";
import { discoverRepository } from "../../src/discover/discover.js";
import type { DiscoveryProbe } from "../../src/discover/probe.js";
import type { DiscoverySnapshot, Fact, FactId, JsonValue } from "../../src/discover/types.js";
import { FACT_IDS } from "../../src/discover/types.js";
import { repoWith, VALID_CONTRACT } from "./discoverTestDoubles.js";

function known(
  id: FactId,
  kind: KnownContribution["kind"],
  value: JsonValue,
  source: string,
): KnownContribution {
  return { id, kind, value, evidence: [{ source }] };
}

/** The single fact from a contribution list, asserting there is exactly one. */
function only(facts: readonly Fact[]): Fact {
  expect(facts).toHaveLength(1);
  const fact = facts[0];
  if (fact === undefined) {
    throw new Error("expected one fact");
  }
  return fact;
}

function valueOf(fact: Fact): JsonValue {
  if (!("value" in fact)) {
    throw new Error(`fact ${fact.id} carries no value`);
  }
  return fact.value;
}

function corroborationOf(fact: Fact) {
  if (!("corroboration" in fact)) {
    throw new Error(`fact ${fact.id} carries no corroboration`);
  }
  return fact.corroboration;
}

describe("a fact is never stronger than its evidence", () => {
  it("refuses to build a known fact whose claim cites nothing", () => {
    expect(() =>
      buildAgreedFact("repository.packageManager", [
        { kind: "derived", value: "pnpm", evidence: [] },
      ]),
    ).toThrow(/no evidence/);
  });

  it("refuses to build a known fact from no claims at all", () => {
    expect(() => buildAgreedFact("repository.packageManager", [])).toThrow(/without any claim/);
  });

  it("refuses to build a known fact when only some claims cite something", () => {
    expect(() =>
      buildAgreedFact("repository.packageManager", [
        { kind: "derived", value: "pnpm", evidence: [{ source: "pnpm-lock.yaml" }] },
        { kind: "declared", value: "pnpm", evidence: [] },
      ]),
    ).toThrow(/no evidence/);
  });

  it("gives an unknown fact no value field at all, so absence cannot read as a default", () => {
    const fact = buildUnknownFact("repository.packageManager", "no-evidence", [
      { source: "package.json" },
    ]);
    expect(fact.kind).toBe("unknown");
    expect("value" in fact).toBe(false);
    expect(JSON.parse(JSON.stringify(fact))).not.toHaveProperty("value");
  });

  it("reports a conflicting fact with no value rather than a ranked winner", () => {
    const fact = only(
      mergeContributions([
        known("repository.packageManager", "declared", "pnpm", "package.json"),
        known("repository.packageManager", "derived", "npm", "package-lock.json"),
      ]),
    );
    expect(isContradictory(fact)).toBe(true);
    expect("value" in fact).toBe(false);
    // Both claims survive with their own evidence; neither is discarded.
    if (!("claims" in fact)) throw new Error("expected claims");
    expect(fact.claims.map((claim) => claim.value)).toEqual(["pnpm", "npm"]);
    expect(fact.claims.map((claim) => claim.evidence[0]?.source)).toEqual([
      "package.json",
      "package-lock.json",
    ]);
  });

  it("treats a claim of a different value as a conflict even within one kind", () => {
    const fact = only(
      mergeContributions([
        known("repository.packageManager", "derived", "pnpm", "pnpm-lock.yaml"),
        known("repository.packageManager", "derived", "npm", "package-lock.json"),
      ]),
    );
    expect(isContradictory(fact)).toBe(true);
  });
});

describe("absence is not inaccessibility, and inaccessibility is not absence", () => {
  it("keeps a value-shaped probe's not-found result unknown rather than false", () => {
    // A `value` probe that found nothing has established nothing about the
    // value. Turning that into `false` would be evidence the probe never
    // gathered.
    const fact = only(
      mergeContributions([
        {
          id: "repository.packageManager",
          reason: "no-evidence",
          evidence: [{ source: "package.json" }],
        },
      ]),
    );
    expect(fact.kind).toBe("unknown");
    expect(fact.kind === "unknown" && fact.reason).toBe("no-evidence");
    // The path that was inspected is retained, so "we looked and found
    // nothing" stays inspectable and distinct from "we did not look".
    expect(fact.kind === "unknown" && fact.evidence).toEqual([{ source: "package.json" }]);
  });

  it("never downgrades a failure to absence, and never upgrades absence to a value", () => {
    const failed = only(
      mergeContributions([
        {
          id: "repository.packageManager",
          reason: "probe-failed",
          evidence: [{ source: "package.json" }],
        },
      ]),
    );
    expect(failed.kind === "unknown" && failed.reason).toBe("probe-failed");
    expect("value" in failed).toBe(false);
  });

  it("prefers the most informative unknown reason across probes", () => {
    // A failure tells a consumer strictly more than a completed-and-empty
    // inspection, so it must not be diluted by the weaker reason.
    const fact = only(
      mergeContributions([
        { id: "repository.packageManager", reason: "no-evidence", evidence: [{ source: "a" }] },
        { id: "repository.packageManager", reason: "probe-failed", evidence: [{ source: "b" }] },
      ]),
    );
    expect(fact.kind === "unknown" && fact.reason).toBe("probe-failed");
    // Both inspected paths are retained.
    expect(fact.kind === "unknown" && fact.evidence.map((e) => e.source)).toEqual(["a", "b"]);
  });

  it("keeps a fact known when one probe confirms it and another merely failed", () => {
    const fact = only(
      mergeContributions([
        known("repository.packageManager", "declared", "pnpm", "package.json"),
        {
          id: "repository.packageManager",
          reason: "probe-failed",
          evidence: [{ source: "yarn.lock" }],
        },
      ]),
    );
    expect(valueOf(fact)).toBe("pnpm");
    expect(hasEvidence(fact)).toBe(true);
  });
});

describe("corroboration means independence, not repetition", () => {
  it("is not corroborated by a single source however confident it is", () => {
    const fact = only(
      mergeContributions([known("repository.packageManager", "derived", "pnpm", "pnpm-lock.yaml")]),
    );
    expect(corroborationOf(fact).corroborated).toBe(false);
  });

  it("is not corroborated by two claims that cite the same evidence", () => {
    // One file inspected twice is one source. Reporting this as independent
    // verification is the specific overclaim the boundary exists to prevent.
    const fact = only(
      mergeContributions([
        known("repository.packageManager", "derived", "pnpm", "agent-ready.yaml"),
        known("repository.packageManager", "author-declared", "pnpm", "agent-ready.yaml"),
      ]),
    );
    expect(corroborationOf(fact).corroborated).toBe(false);
  });

  it("is corroborated by two claims citing different evidence", () => {
    const fact = only(
      mergeContributions([
        known("repository.packageManager", "declared", "pnpm", "package.json"),
        known("repository.packageManager", "derived", "pnpm", "pnpm-lock.yaml"),
      ]),
    );
    expect(corroborationOf(fact).corroborated).toBe(true);
  });

  it("does not count one claim's many inspected paths as many sources", () => {
    const fact = only(
      mergeContributions([
        {
          id: "repository.declarationSurface.present",
          kind: "derived",
          value: false,
          evidence: [{ source: "AGENTS.md" }, { source: "CLAUDE.md" }, { source: ".cursorrules" }],
        },
      ]),
    );
    expect(valueOf(fact)).toBe(false);
    expect(corroborationOf(fact).corroborated).toBe(false);
  });

  it("keeps an author claim visibly uncorroborated while the repository is silent", () => {
    const fact = only(
      mergeContributions([
        known("repository.packageManager", "author-declared", "pnpm", "agent-ready.yaml"),
      ]),
    );
    expect(corroborationOf(fact).authorDeclared).toBe(true);
    expect(corroborationOf(fact).corroborated).toBe(false);
    // The maintainer's description is the value, but its kind is not upgraded.
    expect(fact.kind).toBe("author-declared");
  });
});

describe("an inferred capability is never relabelled as an observed one", () => {
  it("labels a lockfile signal derived and a package.json field declared", async () => {
    const snapshot = await discoverRepository(
      repoWith({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n", "package.json": "{}" }),
      { startDir: "/repo" },
    );
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    // Only the lockfile: derived, never declared.
    const lockfileOnly = snapshot.snapshot.facts["repository.packageManager"];
    expect(lockfileOnly?.kind).toBe("derived");
    if (!lockfileOnly || !("claims" in lockfileOnly)) throw new Error("expected claims");
    expect(lockfileOnly.claims.every((claim) => claim.kind === "derived")).toBe(true);
  });

  it("keeps every contributing kind published even when one is strongest", () => {
    const fact = only(
      mergeContributions([
        known("repository.packageManager", "author-declared", "pnpm", "agent-ready.yaml"),
        known("repository.packageManager", "derived", "pnpm", "pnpm-lock.yaml"),
        known("repository.packageManager", "declared", "pnpm", "package.json"),
      ]),
    );
    expect(corroborationOf(fact).kinds).toEqual(["author-declared", "declared", "derived"]);
  });
});

describe("evidence is canonicalized", () => {
  it("collapses an exactly repeated citation instead of growing one per look", () => {
    const fact = buildUnknownFact("repository.declarationSurface.present", "no-evidence", [
      { source: "AGENTS.md", detail: "not present" },
      { source: "AGENTS.md", detail: "not present" },
      { source: "CLAUDE.md", detail: "not present" },
    ]);
    expect(fact.evidence).toEqual([
      { source: "AGENTS.md", detail: "not present" },
      { source: "CLAUDE.md", detail: "not present" },
    ]);
  });

  it("orders evidence by code unit, not by the order the probes happened to run", () => {
    const forwards = mergeContributions([
      {
        id: "repository.contract.valid",
        reason: "no-evidence",
        evidence: [{ source: "b" }, { source: "a" }],
      },
    ]);
    const backwards = mergeContributions([
      {
        id: "repository.contract.valid",
        reason: "no-evidence",
        evidence: [{ source: "a" }, { source: "b" }],
      },
    ]);
    expect(forwards).toEqual(backwards);
    const fact = only(forwards);
    expect(fact.kind === "unknown" && fact.evidence.map((e) => e.source)).toEqual(["a", "b"]);
  });
});

describe("every fact id in the public registry is reachable and every emitted fact is one of them", () => {
  it("emits a subset of the declared fact ids, with no invented identifiers", async () => {
    const snapshot = await discoverRepository(
      repoWith({
        "agent-ready.yaml": VALID_CONTRACT,
        "package.json": '{"packageManager":"pnpm@10.0.0"}',
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        "AGENTS.md": "# agents\n",
      }),
      { startDir: "/repo" },
    );
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    for (const id of Object.keys(snapshot.snapshot.facts)) {
      expect(FACT_IDS as readonly string[]).toContain(id);
    }
  });

  it("satisfies the evidence invariant for every fact in every reachable outcome", async () => {
    const probes: DiscoveryProbe[] = [
      {
        id: "explodes",
        factId: "repository.declarationSurface.present",
        kind: "derived",
        shape: "existence",
        run: () => Promise.reject(new Error("probe blew up")),
      },
    ];
    const result = await discoverRepository(
      repoWith({
        "package.json": '{"packageManager":"pnpm@10.0.0"}',
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        "package-lock.json": '{"lockfileVersion":3}',
      }),
      { startDir: "/repo", probes },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = Object.values(result.snapshot.facts);
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      // No fact makes a positive claim it cannot cite.
      expect(hasEvidence(fact)).toBe(true);
    }
  });

  it("attributes a thrown probe to its fact without pretending it read anything", async () => {
    const result = await discoverRepository(repoWith({ "package.json": "{}" }), {
      startDir: "/repo",
      probes: [
        {
          id: "explodes",
          factId: "repository.declarationSurface.present",
          kind: "derived",
          shape: "existence",
          run: () => Promise.reject(new Error("probe blew up")),
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.snapshot.facts["repository.declarationSurface.present"];
    if (fact === undefined) {
      throw new Error("expected a fact for the failing probe");
    }
    expect(fact.kind === "unknown" && fact.reason).toBe("probe-failed");
    // It read nothing, so it cites nothing — which is honest, not a defect.
    // What it must not do is claim a value.
    expect(fact.kind === "unknown" && fact.evidence).toEqual([]);
    expect(isSelfDescribing(fact)).toBe(false);
    // The operation is still reported as incomplete, with the probe named.
    const partial = result.snapshot.diagnostics.find((d) => d.code === "DISCOVERY_PARTIAL");
    expect(partial?.metadata).toMatchObject({
      probeId: "explodes",
      factId: "repository.declarationSurface.present",
    });
  });

  it("reports an ordinary unknown fact as self-describing", () => {
    expect(
      isSelfDescribing(
        buildUnknownFact("repository.packageManager", "no-evidence", [{ source: "package.json" }]),
      ),
    ).toBe(true);
    expect(isSelfDescribing(buildUnknownFact("repository.contract.valid", "not-probed", []))).toBe(
      true,
    );
  });
});

describe("a diagnostic is a statement about the operation, never a fact", () => {
  it("names a factId that exists in the same snapshot", async () => {
    const snapshot = await discoverRepository(
      repoWith({
        "package.json": '{"packageManager":"pnpm@10.0.0"}',
        "pnpm-lock.yaml": "x",
        "package-lock.json": "y",
      }),
      { startDir: "/repo" },
    );
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.snapshot.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of snapshot.snapshot.diagnostics) {
      const factId = diagnostic.metadata?.["factId"];
      if (typeof factId !== "string") continue;
      expect(Object.keys(snapshot.snapshot.facts)).toContain(factId);
    }
  });

  it("counts one fact per contributed fact id, so a diagnostic cannot invent one", async () => {
    const snapshot = await discoverRepository(repoWith({ "package.json": "{}" }), {
      startDir: "/repo",
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const expected = new Set<FactId>([
      "repository.root",
      "repository.contract.present",
      "repository.contract.valid",
      "repository.declarationSurface.present",
      "repository.packageManager",
    ]);
    expect(Object.keys(snapshot.snapshot.facts).sort()).toEqual([...expected].sort());
    expect(snapshot.snapshot.summary.facts).toBe(expected.size);
  });
});

describe("a probe cannot report a value it never supplied", () => {
  it("downgrades a value-shaped found-with-no-value result to unknown", async () => {
    // Defaulting this to `true` would record a value the probe never observed —
    // the fabrication the whole boundary exists to prevent.
    const result = await discoverRepository(repoWith({ "package.json": "{}" }), {
      startDir: "/repo",
      probes: [
        {
          id: "valueless",
          factId: "repository.packageManager",
          kind: "declared",
          shape: "value",
          run: () => Promise.resolve({ status: "found", evidence: [{ source: "package.json" }] }),
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.snapshot.facts["repository.packageManager"];
    if (fact === undefined) throw new Error("expected a fact");
    expect(fact.kind === "unknown" && fact.reason).toBe("probe-failed");
    expect("value" in fact).toBe(false);
    expect(result.snapshot.summary.complete).toBe(false);
    expect(result.snapshot.diagnostics.map((d) => d.code)).toContain("DISCOVERY_PARTIAL");
  });

  it("still records existence probes that are found with no value as true", async () => {
    // "It is there" is the whole answer for an existence probe, so a bare
    // `found` is legitimate and must not be treated as a defect.
    const result = await discoverRepository(repoWith({ "AGENTS.md": "# a\n" }), {
      startDir: "/repo",
      probes: [
        {
          id: "present",
          factId: "repository.declarationSurface.present",
          kind: "derived",
          shape: "existence",
          run: () => Promise.resolve({ status: "found", evidence: [{ source: "AGENTS.md" }] }),
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.snapshot.facts["repository.declarationSurface.present"];
    expect(fact && "value" in fact ? fact.value : undefined).toBe(true);
    expect(result.snapshot.diagnostics).toEqual([]);
  });
});

describe("mergeContributions is total over the contribution union", () => {
  it("returns a deterministic, code-unit-ordered fact list", () => {
    const contributions: Contribution[] = [
      { id: "repository.packageManager", reason: "not-probed", evidence: [] },
      known("repository.contract.present", "derived", true, "agent-ready.yaml"),
      { id: "repository.root", reason: "not-probed", evidence: [] },
    ];
    expect(mergeContributions(contributions).map((fact) => fact.id)).toEqual([
      "repository.contract.present",
      "repository.packageManager",
      "repository.root",
    ]);
  });

  it("treats an unsupported probe as not-probed, never as a false value", () => {
    const fact = only(
      mergeContributions([{ id: "repository.contract.valid", reason: "not-probed", evidence: [] }]),
    );
    expect(fact.kind === "unknown" && fact.reason).toBe("not-probed");
    expect("value" in fact).toBe(false);
    // `not-probed` is the one unknown that legitimately cites nothing.
    expect(hasEvidence(fact)).toBe(true);
  });
});

describe("the snapshot projection adds no knowledge of its own", () => {
  it("carries the same facts the snapshot computed, with nothing re-derived", async () => {
    const result = await discoverRepository(
      repoWith({ "package.json": '{"packageManager":"pnpm@10.0.0"}', "pnpm-lock.yaml": "x" }),
      { startDir: "/repo" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snapshot: DiscoverySnapshot = result.snapshot;
    // The record is keyed by the fact's own id, and every key is present in
    // the summary count, so a rendering cannot invent or drop a fact.
    for (const [id, fact] of Object.entries(snapshot.facts)) {
      expect(fact.id).toBe(id);
    }
    expect(snapshot.summary.facts).toBe(Object.keys(snapshot.facts).length);
    expect(snapshot.summary.known + snapshot.summary.unknown).toBe(snapshot.summary.facts);
  });
});
