import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverRepository, DEFAULT_PROBES } from "../../src/discover/discover.js";
import { buildAgreedFact, hasEvidence, mergeContributions } from "../../src/discover/fact.js";
import type { DiscoverySnapshot, Fact } from "../../src/discover/types.js";
import { DIAGNOSTIC_CODES } from "../../src/diagnostics/codes.js";
import { runDiscover } from "../../src/cli/commands/discover.js";
import {
  claimingValue,
  FaultyFileSystem,
  probeReporting,
  RecordingFileSystem,
  repoWith,
  VALID_CONTRACT,
} from "./discoverTestDoubles.js";

async function discover(fs: Parameters<typeof discoverRepository>[0]) {
  const result = await discoverRepository(fs, { startDir: fs.cwd });
  if (!result.ok) {
    throw new Error("expected discovery to succeed");
  }
  return result.snapshot;
}

function fact(snapshot: DiscoverySnapshot, id: string): Fact {
  const found = snapshot.facts[id];
  if (found === undefined) {
    throw new Error(`expected a fact at ${id}`);
  }
  return found;
}

const CODES = (snapshot: DiscoverySnapshot): string[] =>
  snapshot.diagnostics.map((diagnostic) => diagnostic.code);

/**
 * The substrate is proved two ways: against the real probes where they apply,
 * and against injected probes where the scenario needs a signal discovery does
 * not read. Issue #37 added the first real domain, so the layering assertion
 * below moved: the substrate-only guarantee is now about *commands and graphs*,
 * which are the next issues, rather than about packages.
 */
const SURFACE = "repository.declarationSurface.present";
const PRESENCE = "repository.contract.present";

describe("the production probe set is the substrate plus the package domain", () => {
  it("probes exactly the fixed, versioned set of probe ids", () => {
    // A fixed list, not a computed one: the probe set is part of what makes a
    // snapshot reproducible, so a probe appearing or vanishing silently would
    // change every snapshot without changing a fact id.
    expect(DEFAULT_PROBES.map((probe) => probe.id)).toEqual([
      "contract.presence",
      "contract.validity",
      "declaration-surface.presence",
      "packages.inventory",
      "workspace.declarations",
      "workspace.candidates",
      "workspace.members",
      "workspace.root",
      "package-manager.declaration",
      "package-manager.lockfiles",
      "contract.package-manager-claim",
    ]);
  });

  it("reads no command, verification, or module-graph signal", () => {
    // Those are Issues #38 and #39. If a probe for one of them appears here,
    // the layering has been lost: a domain arriving early would put the next
    // issue's architecture decisions in this review.
    const laterIssues = [
      "commands.discovery",
      "verification.discovery",
      "module-graph",
      "imports",
      "dependency-graph",
      "ownership",
    ];
    for (const probe of DEFAULT_PROBES) {
      expect(laterIssues).not.toContain(probe.id);
    }
  });
});

describe("repository without an Agent-Ready contract", () => {
  it("succeeds, reports contract absence as a fact, and never fails with CONTRACT_NOT_FOUND", async () => {
    const snapshot = await discover(repoWith({ "AGENTS.md": "# agents\n" }));

    expect(snapshot.ok).toBe(true);
    expect(fact(snapshot, PRESENCE)).toMatchObject({
      kind: "derived",
      value: false,
    });
    expect(CODES(snapshot)).not.toContain("CONTRACT_NOT_FOUND");
    expect(snapshot.summary.complete).toBe(true);
  });

  it("reports validity as not probed rather than invalid, because there is nothing to validate", async () => {
    const snapshot = await discover(repoWith({ "AGENTS.md": "# agents\n" }));
    expect(fact(snapshot, "repository.contract.valid")).toMatchObject({
      kind: "unknown",
      reason: "not-probed",
    });
  });

  it("reports a repository with no signals at all as a complete result", async () => {
    const snapshot = await discover(repoWith({}));
    expect(snapshot.summary.unknown).toBeGreaterThan(0);
    expect(snapshot.summary.complete).toBe(true);
    expect(CODES(snapshot)).toContain("DISCOVERY_NO_SIGNALS");
  });
});

describe("repository with a valid contract", () => {
  it("reports contract presence and validity as known true", async () => {
    const snapshot = await discover(
      repoWith({ "agent-ready.yaml": VALID_CONTRACT, "AGENTS.md": "# agents\n" }),
    );
    expect(fact(snapshot, PRESENCE)).toMatchObject({ value: true });
    expect(fact(snapshot, "repository.contract.valid")).toMatchObject({ value: true });
  });

  it("records the contract's claim as author-declared, never as a repository fact", async () => {
    // VALID_CONTRACT declares `packageManager: pnpm`. Issue #37 added the
    // author-declared channel, so the claim is now read — but the kind is the
    // whole point of reading it. A claim that appeared as `declared` or
    // `derived` would make a hand-written description indistinguishable from
    // something discovered, which is exactly what would invalidate the Phase 1
    // benchmark.
    const snapshot = await discover(repoWith({ "agent-ready.yaml": VALID_CONTRACT }));
    const managerFact = fact(snapshot, "repository.packageManager.root");
    if (managerFact.kind === "unknown") {
      throw new Error("expected the contract's claim to produce a known fact");
    }
    expect(managerFact.corroboration).toMatchObject({
      authorDeclared: true,
      // Only the contract asserts anything, so nothing corroborates it. An
      // uncorroborated author claim is precisely the state ADR-0044 requires to
      // stay visible rather than be quietly accepted.
      corroborated: false,
    });
    if (!("claims" in managerFact)) throw new Error("expected a known fact");
    const authorClaims = managerFact.claims.filter((claim) => claim.kind === "author-declared");
    expect(authorClaims).toHaveLength(1);
    expect(authorClaims[0]?.evidence[0]?.source).toBe("agent-ready.yaml");

    // No *repository-derived* fact may cite the contract as its evidence. The
    // contract's own presence and validity facts do cite it, which is correct
    // and different in kind: those facts are about whether the file exists, not
    // about anything it says.
    for (const [id, entry] of Object.entries(snapshot.facts)) {
      if (id.startsWith("repository.contract.")) continue;
      if (id.startsWith("repository.packageManager.")) continue;
      if (!("claims" in entry)) continue;
      for (const claim of entry.claims) {
        expect(
          claim.evidence.some((item) => item.source === "agent-ready.yaml"),
          `${id} cited the contract as evidence for a ${claim.kind} claim`,
        ).toBe(false);
      }
    }
  });

  it("reports identical repository-derived facts with and without a contract", async () => {
    // ADR-0044's third rule: the contract changes which facts become
    // *available*, never which become *true*. Every fact the contract does not
    // contribute to must be byte-identical either way, which is the comparison
    // that keeps the Phase 1 benchmark honest.
    const manifest = JSON.stringify({ name: "fixture" });
    const withoutContract = await discover(repoWith({ "package.json": manifest }));
    const withContract = await discover(
      repoWith({ "package.json": manifest, "agent-ready.yaml": VALID_CONTRACT }),
    );

    for (const id of [
      "repository.packages",
      "repository.workspace.declarations",
      "repository.workspace.candidates",
      "repository.workspace.members",
      "repository.workspace.root",
      "repository.root",
    ] as const) {
      expect(
        JSON.stringify(withoutContract.facts[id]),
        `${id} changed when a contract was added`,
      ).toBe(JSON.stringify(withContract.facts[id]));
    }

    // The package manager is the one fact the contract contributes to, and it
    // contributes a *claim* rather than replacing a value. With no repository
    // evidence either way, the fact is carried entirely by the author's word,
    // and the snapshot says so through both fields rather than presenting a
    // claim as something discovered: the kind is `author-declared` because
    // nothing else supports it, and it is not corroborated.
    //
    // Reporting it as `unknown` instead was considered and rejected. ADR-0044
    // keeps an uncorroborated author claim *visible* — discarding it would
    // make `discover` artificially weak on exactly the repositories that have
    // already described themselves, and rule 3 says the contract changes which
    // facts become available, never which become true.
    const managers = Object.entries(withContract.facts).filter(([id]) =>
      id.startsWith("repository.packageManager."),
    );
    expect(managers).toHaveLength(1);
    const manager = managers[0]?.[1];
    if (manager === undefined || manager.kind === "unknown") {
      throw new Error("expected the contract's claim to produce a known fact");
    }
    expect(manager.corroboration).toMatchObject({
      authorDeclared: true,
      corroborated: false,
    });
    expect(manager.kind).toBe("author-declared");
  });
});

describe("a value the probe reported is never rewritten", () => {
  it("records an observed null as the fact's value, never as true", async () => {
    // `JsonValue` includes `null`, so a value-shaped probe can legitimately
    // report it. Defaulting on nullishness would turn "the value is null" into
    // "the value is true" — a fabricated claim, invented by the orchestrator
    // rather than observed by the probe.
    const result = await discoverRepository(repoWith({}), {
      startDir: "/repo",
      probes: [claimingValue("reports-null", SURFACE, "declared", null, "signals.json")],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.snapshot.facts[SURFACE];
    if (fact === undefined) throw new Error("expected a fact");
    expect("value" in fact).toBe(true);
    expect("value" in fact ? fact.value : "absent").toBeNull();
    // And specifically not the existence default.
    expect("value" in fact ? fact.value : true).not.toBe(true);
  });

  it("keeps an existence probe's explicit false rather than defaulting it to true", async () => {
    // A repository whose `agent-ready.yaml` is a directory. The probe observed
    // something — a path named agent-ready.yaml that is not a regular file —
    // and reported that observation as `false`. A shape-based default would
    // have reported the contract as present.
    const fs = repoWith({});
    fs.addDirectory("/repo/agent-ready.yaml");
    const snapshot = await discover(fs);
    const present = fact(snapshot, PRESENCE);
    expect(present).toMatchObject({ value: false, kind: "derived" });
    expect("claims" in present && present.claims[0]?.evidence[0]?.detail).toContain(
      "not a regular file",
    );
  });

  it("still records an existence probe that reported no value as true", async () => {
    const snapshot = await discover(repoWith({ "AGENTS.md": "# agents\n" }));
    expect(fact(snapshot, SURFACE)).toMatchObject({ value: true });
  });
});

describe("repository with a malformed contract", () => {
  it("keeps repository discovery usable and separates existence from validity", async () => {
    const snapshot = await discover(
      repoWith({
        "agent-ready.yaml": "version: 1\nproject: [this is not a mapping\n",
        "AGENTS.md": "# agents\n",
      }),
    );

    expect(snapshot.ok).toBe(true);
    expect(fact(snapshot, PRESENCE)).toMatchObject({ value: true });
    // The repository is still discoverable; only the contract is not valid.
    expect(fact(snapshot, "repository.contract.valid")).toMatchObject({ value: false });
    expect(fact(snapshot, SURFACE)).toMatchObject({ value: true });
  });

  it("reports the contract as invalid rather than as a failed discovery", async () => {
    const snapshot = await discover(
      repoWith({ "agent-ready.yaml": "version: [broken\n", "AGENTS.md": "# agents\n" }),
    );
    expect(snapshot.summary.complete).toBe(true);
    expect(CODES(snapshot)).not.toContain("DISCOVERY_PARTIAL");
    expect(CODES(snapshot)).not.toContain("CONTRACT_NOT_FOUND");
  });
});

describe("probe failure", () => {
  it("reports a failed probe as unknown with reason probe-failed and a matching diagnostic", async () => {
    const fs = new FaultyFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/AGENTS.md", "# agents\n");
    fs.failOn("/repo/AGENTS.md");

    const snapshot = await discover(fs);

    expect(fact(snapshot, SURFACE)).toMatchObject({
      kind: "unknown",
      reason: "probe-failed",
    });
    expect(CODES(snapshot)).toContain("DISCOVERY_PARTIAL");
    expect(snapshot.summary.complete).toBe(false);
  });

  it("does not treat a probe that throws as a repository fact", async () => {
    const result = await discoverRepository(repoWith({}), {
      startDir: "/repo",
      probes: [
        probeReporting("explodes", SURFACE, "existence", "derived", {
          status: "failed",
          detail: "probe blew up",
          evidence: [],
        }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fact(result.snapshot, SURFACE)).toMatchObject({
      kind: "unknown",
      reason: "probe-failed",
    });
    expect(CODES(result.snapshot)).toContain("DISCOVERY_PARTIAL");
  });

  it("downgrades a thrown probe to a failed probe", async () => {
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
    const partial = result.snapshot.diagnostics.find((d) => d.code === "DISCOVERY_PARTIAL");
    expect(partial?.detail).toContain("probe blew up");
    expect(result.snapshot.summary.complete).toBe(false);
  });
});

describe("absence is not inaccessibility", () => {
  it("produces different facts for a missing file and a file that could not be inspected", async () => {
    const absent = await discover(repoWith({ "agent-ready.yaml": VALID_CONTRACT }));
    expect(fact(absent, SURFACE)).toMatchObject({ value: false });
    expect(CODES(absent)).not.toContain("DISCOVERY_PARTIAL");

    const fs = new FaultyFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/AGENTS.md", "# agents\n");
    fs.failOn("/repo/AGENTS.md");

    const inaccessible = await discover(fs);
    expect(fact(inaccessible, SURFACE)).toMatchObject({
      kind: "unknown",
      reason: "probe-failed",
    });
    expect(CODES(inaccessible)).toContain("DISCOVERY_PARTIAL");
  });

  it("does not resolve the whole fact to unknown when one of several probed paths is unreadable", async () => {
    const fs = new FaultyFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/AGENTS.md", "# agents\n");
    fs.failOn("/repo/CLAUDE.md");
    const snapshot = await discover(fs);
    // Presence is genuinely unknown, because one path was unreadable, even
    // though AGENTS.md was found. Guessing "yes" here would be fabrication.
    expect(fact(snapshot, SURFACE).kind).toBe("unknown");
  });
});

describe("the evidence invariant", () => {
  it("gives every known fact at least one piece of evidence", async () => {
    const snapshot = await discover(
      repoWith({
        "agent-ready.yaml": VALID_CONTRACT,
        "AGENTS.md": "# agents\n",
        ".github/workflows": "on: push\n",
      }),
    );
    for (const entry of Object.values(snapshot.facts)) {
      expect(hasEvidence(entry)).toBe(true);
    }
  });

  it("refuses to build a known fact whose claim cites nothing", () => {
    expect(() =>
      buildAgreedFact("repository.contract.present", [
        { kind: "derived", value: true, evidence: [] },
      ]),
    ).toThrow(/no evidence/);
  });

  it("refuses to build a known fact from no claims at all", () => {
    expect(() => buildAgreedFact("repository.contract.present", [])).toThrow(/without any claim/);
  });

  it("lets an unknown fact with no evidence exist only when it was not probed", async () => {
    const snapshot = await discover(repoWith({ "AGENTS.md": "# agents\n" }));
    const validity = fact(snapshot, "repository.contract.valid");
    expect(validity.kind === "unknown" && validity.reason).toBe("not-probed");
    expect(validity.kind === "unknown" && validity.evidence).toEqual([]);
  });
});

describe("contradiction preservation, with injected probes", () => {
  it("retains both claims and names no winner", async () => {
    const result = await discoverRepository(repoWith({}), {
      startDir: "/repo",
      probes: [
        claimingValue("signals-a", SURFACE, "declared", "one", "signals-a.json"),
        claimingValue("signals-b", SURFACE, "derived", "two", "signals-b.json"),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const conflicted = result.snapshot.facts[SURFACE];
    if (conflicted === undefined) throw new Error("expected a fact");
    expect("value" in conflicted).toBe(false);
    if (!("claims" in conflicted)) throw new Error("expected claims");
    expect(conflicted.claims.map((claim) => [claim.kind, claim.value])).toEqual([
      ["declared", "one"],
      ["derived", "two"],
    ]);
    // Every claim still cites the file it came from.
    expect(conflicted.claims.every((claim) => claim.evidence.length > 0)).toBe(true);
    expect(CODES(result.snapshot)).toContain("DISCOVERY_FACT_CONFLICT");
  });

  it("agrees without conflicting when every source says the same thing", async () => {
    const result = await discoverRepository(repoWith({}), {
      startDir: "/repo",
      probes: [
        claimingValue("signals-a", SURFACE, "declared", "same", "signals-a.json"),
        claimingValue("signals-b", SURFACE, "derived", "same", "signals-b.json"),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const agreed = result.snapshot.facts[SURFACE];
    if (agreed === undefined) throw new Error("expected a fact");
    expect(agreed).toMatchObject({ value: "same" });
    expect("corroboration" in agreed && agreed.corroboration.kinds).toEqual([
      "declared",
      "derived",
    ]);
    expect(CODES(result.snapshot)).not.toContain("DISCOVERY_FACT_CONFLICT");
  });

  it("treats an author's claim as a claim, never as an overwrite", async () => {
    const result = await discoverRepository(repoWith({}), {
      startDir: "/repo",
      probes: [
        claimingValue("repository-says", SURFACE, "derived", "observed", "observed.json"),
        claimingValue("author-says", SURFACE, "author-declared", "claimed", "contract.yaml"),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const conflicted = result.snapshot.facts[SURFACE];
    if (conflicted === undefined) throw new Error("expected a fact");
    // The claim is retained and labelled; nothing is preferred.
    expect("value" in conflicted).toBe(false);
    if (!("corroboration" in conflicted)) throw new Error("expected corroboration");
    expect(conflicted.corroboration.authorDeclared).toBe(true);
    expect(conflicted.corroboration.corroborated).toBe(false);
  });

  it("combines contributions that share a fact id rather than emitting two facts", () => {
    const merged = mergeContributions([
      {
        id: SURFACE,
        kind: "declared",
        value: "one",
        evidence: [{ source: "a.json" }],
      },
      {
        id: SURFACE,
        kind: "derived",
        value: "two",
        evidence: [{ source: "b.json" }],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBeDefined();
    expect("value" in (merged[0] ?? { kind: "unknown" })).toBe(false);
  });
});

describe("determinism", () => {
  it("produces deeply equal snapshots for identical inputs", async () => {
    const files = {
      "agent-ready.yaml": VALID_CONTRACT,
      "AGENTS.md": "# agents\n",
      ".github/workflows/ci.yml": "on: push\n",
    };
    const first = await discover(repoWith(files));
    const second = await discover(repoWith(files));
    expect(second).toEqual(first);
  });

  it("excludes absolute paths so output does not depend on the checkout location", async () => {
    const snapshot = await discover(repoWith({ "AGENTS.md": "# a\n" }));
    expect(snapshot.root).toBe(".");
    expect(JSON.stringify(snapshot)).not.toContain("/repo");
    expect(snapshot.facts["repository.root"]).toMatchObject({ value: "." });
  });

  it("orders facts and diagnostics identically across runs regardless of probe order", async () => {
    const files = { "AGENTS.md": "# agents\n" };
    const forward = await discoverRepository(repoWith(files), {
      startDir: "/repo",
      probes: DEFAULT_PROBES,
    });
    const reversed = await discoverRepository(repoWith(files), {
      startDir: "/repo",
      probes: [...DEFAULT_PROBES].reverse(),
    });
    expect(reversed.ok && forward.ok && JSON.stringify(reversed.snapshot)).toBe(
      forward.ok && JSON.stringify(forward.snapshot),
    );
  });
});

describe("strict read-only behaviour", () => {
  it("performs zero writes, directory creations, or deletions", async () => {
    const fs = new RecordingFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/agent-ready.yaml", VALID_CONTRACT);
    fs.addFile("/repo/AGENTS.md", "# agents\n");

    await discoverRepository(fs, { startDir: "/repo" });

    expect(fs.mutatingCalls()).toEqual([]);
    expect(fs.calls.length).toBeGreaterThan(0);
  });

  it("performs zero writes through the command surface too", async () => {
    const fs = new RecordingFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/AGENTS.md", "# agents\n");

    const outcome = await runDiscover(fs, { json: false });

    expect(fs.mutatingCalls()).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });

  it("imports no process runner, Git client, network, CLI, or verification module", () => {
    const forbidden =
      /from\s+"(node:(child_process|http|https|net|tls|dgram)|.*(nodeCommandRunner|nodeGitClient|cli\/|verify\/|generate\/))/;
    const files = collectTypeScriptFiles(join(process.cwd(), "src", "discover"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/^import[^;]*from\s+"([^"]+)";/gm)].map(
        (m) => m[1] ?? "",
      );
      for (const specifier of imports) {
        expect(`${file} imports ${specifier}`).not.toMatch(forbidden);
      }
    }
  });
});

describe("diagnostic registry", () => {
  it("reserves the DISCOVERY_ namespace exactly as ADR-0044 and ADR-0045 define it", () => {
    const reserved = DIAGNOSTIC_CODES.filter((code) => code.startsWith("DISCOVERY_"));
    expect(reserved).toEqual([
      "DISCOVERY_ROOT_UNREADABLE",
      "DISCOVERY_PARTIAL",
      "DISCOVERY_FACT_CONFLICT",
      "DISCOVERY_FACT_INCOMPLETE",
      "DISCOVERY_WORKSPACE_UNSUPPORTED",
      "DISCOVERY_LOCKFILE_UNREADABLE",
      "DISCOVERY_NO_SIGNALS",
      "DISCOVERY_FACT_UNSUPPORTED",
    ]);
  });

  it("does not claim unsupported coverage for a repository that merely has none", async () => {
    // The most important negative test for the coverage diagnostic. An empty
    // repository, and a repository with no contract, both make probes return
    // `unsupported` — but for an *absent subject*, which the fact's `not-probed`
    // reason already records. Raising a coverage warning there would put
    // DISCOVERY_FACT_UNSUPPORTED on nearly every repository in existence and
    // train every reader to ignore it.
    const empty = await discover(repoWith({}));
    expect(CODES(empty)).not.toContain("DISCOVERY_FACT_UNSUPPORTED");
    expect(fact(empty, "repository.contract.valid")).toMatchObject({
      kind: "unknown",
      reason: "not-probed",
    });

    const noContract = await discover(repoWith({ "AGENTS.md": "# agents\n" }));
    expect(CODES(noContract)).not.toContain("DISCOVERY_FACT_UNSUPPORTED");
  });

  it("reports a root that cannot be read as the only fatal condition", async () => {
    const result = await discoverRepository(repoWith({}), { startDir: "/repo/does-not-exist" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("DISCOVERY_ROOT_UNREADABLE");
    expect(result.diagnostics[0]?.severity).toBe("error");
  });
});

describe("an unreadable root in the command surface", () => {
  it("still exits successfully for partial knowledge and non-zero only for a fatal root", async () => {
    const partial = await runDiscover(new FaultyFileSystem("/repo"), {
      json: false,
      root: "/repo",
    });
    expect(partial.exitCode).toBe(0);

    const fatal = await runDiscover(repoWith({}), { json: false, root: "/repo/missing" });
    expect(fatal.exitCode).not.toBe(0);
    expect(fatal.stderr).toContain("DISCOVERY_ROOT_UNREADABLE");
  });
});

function collectTypeScriptFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectTypeScriptFiles(path));
    } else if (entry.name.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
}
