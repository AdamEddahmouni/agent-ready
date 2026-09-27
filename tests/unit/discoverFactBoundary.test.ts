/**
 * The epistemic boundary, stated as executable invariants.
 *
 * ADR-0044's governing rule is "unknown beats wrong", which is only meaningful
 * if the ways a system can be confidently wrong are individually pinned. Every
 * test here corresponds to one specific way a snapshot could have lied and did
 * not, and the shared assertion is:
 *
 *   OUTPUT CLAIM STRENGTH <= SUPPORT PROVIDED BY THE EVIDENCE CONTRACT.
 *
 * These are deliberately unit-level and operate on the fact algebra directly,
 * with neutral fixture values, so a regression is attributed to the algebra
 * rather than to whichever probe or rendering happened to exercise it. This
 * issue ships no repository domain, so nothing here depends on one.
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
import { claimingValue, probeReporting, repoWith, VALID_CONTRACT } from "./discoverTestDoubles.js";

/**
 * The fact id the algebra tests report against. Which id is used is
 * irrelevant to the algebra; a real one is used so that the compiler enforces
 * the published vocabulary rather than the tests inventing their own.
 */
const SURFACE: FactId = "repository.declarationSurface.present";

function known(
  kind: KnownContribution["kind"],
  value: JsonValue,
  source: string,
): KnownContribution {
  return { id: SURFACE, kind, value, evidence: [{ source }] };
}

function unknown(
  reason: "no-evidence" | "probe-failed" | "not-probed",
  sources: readonly string[],
): Contribution {
  return { id: SURFACE, reason, evidence: sources.map((source) => ({ source })) };
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

function claimsOf(fact: Fact) {
  if (!("claims" in fact)) {
    throw new Error(`fact ${fact.id} carries no claims`);
  }
  return fact.claims;
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
      buildAgreedFact(SURFACE, [{ kind: "derived", value: true, evidence: [] }]),
    ).toThrow(/no evidence/);
  });

  it("refuses to build a known fact from no claims at all", () => {
    expect(() => buildAgreedFact(SURFACE, [])).toThrow(/without any claim/);
  });

  it("refuses to build a known fact when only some claims cite something", () => {
    expect(() =>
      buildAgreedFact(SURFACE, [
        { kind: "derived", value: true, evidence: [{ source: "a" }] },
        { kind: "declared", value: true, evidence: [] },
      ]),
    ).toThrow(/no evidence/);
  });

  it("gives an unknown fact no value field at all, so absence cannot read as a default", () => {
    const fact = buildUnknownFact(SURFACE, "no-evidence", [{ source: "a" }]);
    expect(fact.kind).toBe("unknown");
    expect("value" in fact).toBe(false);
    expect(JSON.parse(JSON.stringify(fact))).not.toHaveProperty("value");
  });

  it("reports a conflicting fact with no value rather than a ranked winner", () => {
    const fact = only(
      mergeContributions([known("declared", "one", "a.json"), known("derived", "two", "b.json")]),
    );
    expect(isContradictory(fact)).toBe(true);
    expect("value" in fact).toBe(false);
    // Both claims survive with their own evidence; neither is discarded.
    expect(claimsOf(fact).map((claim) => claim.value)).toEqual(["one", "two"]);
    expect(claimsOf(fact).map((claim) => claim.evidence[0]?.source)).toEqual(["a.json", "b.json"]);
  });

  it("treats claims of different values as a conflict even within one kind", () => {
    const fact = only(
      mergeContributions([known("derived", "one", "a.json"), known("derived", "two", "b.json")]),
    );
    expect(isContradictory(fact)).toBe(true);
  });
});

describe("an observed value is recorded, never reinterpreted", () => {
  it("keeps an observed null as null", () => {
    // `JsonValue` includes `null`, so a probe can legitimately report it. The
    // merge must not reinterpret it as an absence, and certainly not as a
    // truthiness default.
    const fact = only(mergeContributions([known("declared", null, "signals.json")]));
    expect(valueOf(fact)).toBeNull();
  });

  it("keeps an observed false as false", () => {
    const fact = only(mergeContributions([known("derived", false, "a.json")]));
    expect(valueOf(fact)).toBe(false);
  });

  it("keeps an observed empty string and zero as themselves", () => {
    expect(valueOf(only(mergeContributions([known("declared", "", "a.json")])))).toBe("");
    expect(valueOf(only(mergeContributions([known("declared", 0, "a.json")])))).toBe(0);
  });

  it("agrees on two identical falsy observations rather than calling it absent", () => {
    const fact = only(
      mergeContributions([known("derived", false, "a.json"), known("declared", false, "b.json")]),
    );
    expect(valueOf(fact)).toBe(false);
    expect(isContradictory(fact)).toBe(false);
  });
});

describe("absence is not inaccessibility, and inaccessibility is not absence", () => {
  it("keeps a value-shaped probe's not-found result unknown rather than false", () => {
    // A probe that found nothing has established nothing about the value.
    // Turning that into `false` would be evidence the probe never gathered.
    const fact = only(mergeContributions([unknown("no-evidence", ["a.json"])]));
    expect(fact.kind).toBe("unknown");
    expect(fact.kind === "unknown" && fact.reason).toBe("no-evidence");
    // The path inspected is retained, so "we looked and found nothing" stays
    // inspectable and distinct from "we did not look".
    expect(fact.kind === "unknown" && fact.evidence).toEqual([{ source: "a.json" }]);
  });

  it("never downgrades a failure to absence, and never upgrades absence to a value", () => {
    const failed = only(mergeContributions([unknown("probe-failed", ["a.json"])]));
    expect(failed.kind === "unknown" && failed.reason).toBe("probe-failed");
    expect("value" in failed).toBe(false);
  });

  it("prefers the most informative unknown reason across probes", () => {
    // A failure tells a consumer strictly more than a completed-and-empty
    // inspection, so it must not be diluted by the weaker reason.
    const fact = only(
      mergeContributions([unknown("no-evidence", ["a"]), unknown("probe-failed", ["b"])]),
    );
    expect(fact.kind === "unknown" && fact.reason).toBe("probe-failed");
    // Both inspected paths are retained.
    expect(fact.kind === "unknown" && fact.evidence.map((e) => e.source)).toEqual(["a", "b"]);
  });

  it("keeps a fact known when one probe confirms it and another merely failed", () => {
    const fact = only(
      mergeContributions([
        known("declared", "observed", "a.json"),
        unknown("probe-failed", ["b.json"]),
      ]),
    );
    expect(valueOf(fact)).toBe("observed");
    expect(hasEvidence(fact)).toBe(true);
  });
});

describe("corroboration means independence, not repetition", () => {
  it("is not corroborated by a single source however confident it is", () => {
    const fact = only(mergeContributions([known("derived", "x", "a.json")]));
    expect(corroborationOf(fact).corroborated).toBe(false);
  });

  it("is not corroborated by two claims that cite the same evidence", () => {
    // One file inspected twice is one source. Reporting this as independent
    // verification is the specific overclaim the boundary exists to prevent.
    const fact = only(
      mergeContributions([known("derived", "x", "same.json"), known("declared", "x", "same.json")]),
    );
    expect(corroborationOf(fact).corroborated).toBe(false);
  });

  it("is corroborated by two claims citing different evidence", () => {
    const fact = only(
      mergeContributions([known("declared", "x", "a.json"), known("derived", "x", "b.json")]),
    );
    expect(corroborationOf(fact).corroborated).toBe(true);
  });

  it("does not count one claim's many inspected paths as many sources", () => {
    const fact = only(
      mergeContributions([
        {
          id: SURFACE,
          kind: "derived",
          value: false,
          evidence: [{ source: "a" }, { source: "b" }, { source: "c" }],
        },
      ]),
    );
    expect(valueOf(fact)).toBe(false);
    expect(corroborationOf(fact).corroborated).toBe(false);
  });

  it("keeps an author claim visibly uncorroborated while the repository is silent", () => {
    const fact = only(mergeContributions([known("author-declared", "x", "contract.yaml")]));
    expect(corroborationOf(fact).authorDeclared).toBe(true);
    expect(corroborationOf(fact).corroborated).toBe(false);
    // The claim is the value, but its kind is never upgraded to observed.
    expect(fact.kind).toBe("author-declared");
  });
});

describe("an inferred capability is never relabelled as an observed one", () => {
  it("keeps every contributing kind published even when one is strongest", () => {
    const fact = only(
      mergeContributions([
        known("author-declared", "x", "contract.yaml"),
        known("derived", "x", "b.json"),
        known("declared", "x", "a.json"),
      ]),
    );
    expect(corroborationOf(fact).kinds).toEqual(["author-declared", "declared", "derived"]);
  });

  it("does not let an author claim overwrite what the repository shows", () => {
    const fact = only(
      mergeContributions([
        known("declared", "observed", "a.json"),
        known("author-declared", "claimed", "contract.yaml"),
      ]),
    );
    expect("value" in fact).toBe(false);
    expect(claimsOf(fact).map((claim) => [claim.kind, claim.value])).toEqual([
      ["author-declared", "claimed"],
      ["declared", "observed"],
    ]);
  });
});

describe("evidence is canonicalized", () => {
  it("collapses an exactly repeated citation instead of growing one per look", () => {
    const fact = buildUnknownFact(SURFACE, "no-evidence", [
      { source: "a", detail: "not present" },
      { source: "a", detail: "not present" },
      { source: "b", detail: "not present" },
    ]);
    expect(fact.evidence).toEqual([
      { source: "a", detail: "not present" },
      { source: "b", detail: "not present" },
    ]);
  });

  it("orders evidence by code unit, not by the order the probes happened to run", () => {
    const forwards = mergeContributions([unknown("no-evidence", ["b", "a"])]);
    const backwards = mergeContributions([unknown("no-evidence", ["a", "b"])]);
    expect(forwards).toEqual(backwards);
    const fact = only(forwards);
    expect(fact.kind === "unknown" && fact.evidence.map((e) => e.source)).toEqual(["a", "b"]);
  });
});

describe("the published fact vocabulary is what the implementation emits", () => {
  it("emits a subset of the declared fact ids, with no invented identifiers", async () => {
    const result = await discoverRepository(
      repoWith({ "agent-ready.yaml": VALID_CONTRACT, "AGENTS.md": "# agents\n" }),
      { startDir: "/repo" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const id of Object.keys(result.snapshot.facts)) {
      expect(FACT_IDS as readonly string[]).toContain(id);
    }
  });

  it("emits exactly the ids the vocabulary declares, with no gaps", async () => {
    const result = await discoverRepository(repoWith({ "AGENTS.md": "# agents\n" }), {
      startDir: "/repo",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.snapshot.facts).sort()).toEqual([...FACT_IDS].sort());
  });

  it("satisfies the evidence invariant for every fact in every reachable outcome", async () => {
    const probes: DiscoveryProbe[] = [
      probeReporting("explodes", SURFACE, "existence", "derived", {
        status: "failed",
        detail: "could not inspect",
        evidence: [],
      }),
    ];
    const result = await discoverRepository(repoWith({ "AGENTS.md": "# agents\n" }), {
      startDir: "/repo",
      probes,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = Object.values(result.snapshot.facts);
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      // No fact makes a positive claim it cannot cite.
      expect(hasEvidence(fact)).toBe(true);
    }
  });

  it("attributes a failed probe to its fact without pretending it read anything", async () => {
    const result = await discoverRepository(repoWith({}), {
      startDir: "/repo",
      probes: [
        {
          id: "explodes",
          factId: SURFACE,
          kind: "derived",
          shape: "existence",
          run: () => Promise.reject(new Error("probe blew up")),
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.snapshot.facts[SURFACE];
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
    expect(partial?.metadata).toMatchObject({ probeId: "explodes", factId: SURFACE });
  });

  it("reports an ordinary unknown fact as self-describing", () => {
    expect(isSelfDescribing(buildUnknownFact(SURFACE, "no-evidence", [{ source: "a" }]))).toBe(
      true,
    );
    expect(isSelfDescribing(buildUnknownFact(SURFACE, "not-probed", []))).toBe(true);
  });
});

describe("a diagnostic is a statement about the operation, never a fact", () => {
  it("names a factId that exists in the same snapshot", async () => {
    const result = await discoverRepository(repoWith({}), {
      startDir: "/repo",
      probes: [
        claimingValue("a", SURFACE, "declared", "one", "a.json"),
        claimingValue("b", SURFACE, "derived", "two", "b.json"),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of result.snapshot.diagnostics) {
      const factId = diagnostic.metadata?.["factId"];
      if (typeof factId !== "string") continue;
      expect(Object.keys(result.snapshot.facts)).toContain(factId);
    }
  });

  it("counts one fact per contributed fact id, so a diagnostic cannot invent one", async () => {
    const result = await discoverRepository(repoWith({ "AGENTS.md": "# agents\n" }), {
      startDir: "/repo",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const emitted = Object.keys(result.snapshot.facts);
    expect(emitted).toHaveLength(FACT_IDS.length);
    expect(result.snapshot.summary.facts).toBe(FACT_IDS.length);
  });
});

describe("mergeContributions is total over the contribution union", () => {
  it("returns a deterministic, code-unit-ordered fact list", () => {
    // Three distinct ids, contributed out of order, so the sort is what is
    // under test rather than the input order.
    const contributions: Contribution[] = [
      { id: "repository.root", reason: "not-probed", evidence: [] },
      known("derived", true, "a.json"),
      { id: "repository.contract.valid", reason: "not-probed", evidence: [] },
    ];
    expect(mergeContributions(contributions).map((fact) => fact.id)).toEqual([
      "repository.contract.valid",
      "repository.declarationSurface.present",
      "repository.root",
    ]);
  });

  it("treats an unsupported probe as not-probed, never as a false value", () => {
    const fact = only(mergeContributions([unknown("not-probed", [])]));
    expect(fact.kind === "unknown" && fact.reason).toBe("not-probed");
    expect("value" in fact).toBe(false);
    // `not-probed` is the one unknown that legitimately cites nothing.
    expect(hasEvidence(fact)).toBe(true);
  });
});

describe("the snapshot projection adds no knowledge of its own", () => {
  it("keys every fact by its own id, and counts match", async () => {
    const result = await discoverRepository(repoWith({ "AGENTS.md": "# agents\n" }), {
      startDir: "/repo",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snapshot: DiscoverySnapshot = result.snapshot;
    for (const [id, fact] of Object.entries(snapshot.facts)) {
      expect(fact.id).toBe(id);
    }
    expect(snapshot.summary.facts).toBe(Object.keys(snapshot.facts).length);
    expect(snapshot.summary.known + snapshot.summary.unknown).toBe(snapshot.summary.facts);
  });
});
