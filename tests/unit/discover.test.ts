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
 * The production probe set is deliberately tiny, so the substrate is proved two
 * ways: against the real probes where they apply, and against injected probes
 * where the scenario needs a signal discovery does not yet read. Package
 * discovery is Issue #37.
 */
const SURFACE = "repository.declarationSurface.present";
const PRESENCE = "repository.contract.present";

describe("the production probe set is the substrate, not a domain", () => {
  it("probes contract presence, contract validity, and declaration surface only", () => {
    expect(DEFAULT_PROBES.map((probe) => probe.id)).toEqual([
      "contract.presence",
      "contract.validity",
      "declaration-surface.presence",
    ]);
  });

  it("reads no package, workspace, or module signal", () => {
    // If a probe for one of these ever appears here, the layering has been
    // lost: those signals are Issue #37's first expansion of the vocabulary.
    const sources = ["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"];
    for (const probe of DEFAULT_PROBES) {
      expect(sources).not.toContain(probe.id);
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

  it("extracts no claim from the contract, so a description cannot become a fact", async () => {
    // VALID_CONTRACT declares `packageManager: pnpm`. Nothing in this issue
    // reads that, and no fact anywhere in the snapshot may carry it.
    const snapshot = await discover(repoWith({ "agent-ready.yaml": VALID_CONTRACT }));
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("pnpm");
    for (const entry of Object.values(snapshot.facts)) {
      if (!("claims" in entry)) continue;
      expect(entry.claims.every((claim) => claim.kind !== "author-declared")).toBe(true);
    }
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
  it("reserves the DISCOVERY_ namespace exactly as ADR-0044 defines it", () => {
    const reserved = DIAGNOSTIC_CODES.filter((code) => code.startsWith("DISCOVERY_"));
    expect(reserved).toEqual([
      "DISCOVERY_ROOT_UNREADABLE",
      "DISCOVERY_PARTIAL",
      "DISCOVERY_FACT_CONFLICT",
      "DISCOVERY_NO_SIGNALS",
      "DISCOVERY_FACT_UNSUPPORTED",
    ]);
  });

  it("never emits the deliberately unreachable reservation", async () => {
    const snapshot = await discover(
      repoWith({ "agent-ready.yaml": VALID_CONTRACT, "AGENTS.md": "# agents\n" }),
    );
    expect(CODES(snapshot)).not.toContain("DISCOVERY_FACT_UNSUPPORTED");
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
