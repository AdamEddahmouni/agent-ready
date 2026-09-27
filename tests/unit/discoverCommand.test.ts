import { describe, expect, it } from "vitest";
import { runDiscover } from "../../src/cli/commands/discover.js";
import { runValidate } from "../../src/cli/commands/validate.js";
import type { DiscoveryProbe } from "../../src/discover/probe.js";
import {
  claimingValue,
  FaultyFileSystem,
  probeReporting,
  RecordingFileSystem,
  repoWith,
} from "./discoverTestDoubles.js";

/**
 * The canonical `--json` interface, asserted in full.
 *
 * This literal is the snapshot. Any accidental change to the output shape —
 * a renamed field, a re-ordered key, a silently dropped evidence entry — fails
 * here rather than surprising a consumer later. Issue #40 will formalize this
 * into a conformance corpus once the format stabilizes.
 *
 * The vocabulary is deliberately four facts wide: root, contract presence,
 * contract validity, and declaration surface. Package-manager and workspace
 * facts are Issue #37's first expansion, and they are added to `FACT_IDS` as
 * declared ids rather than appearing here unannounced.
 *
 * Note `corroborated: false` on every fact below. Each is supported by exactly
 * one source, and `corroborated` means independent corroboration — a single
 * source, however direct, does not confirm itself.
 */
const EXPECTED_SNAPSHOT = `{
  "ok": true,
  "snapshotVersion": 0,
  "root": ".",
  "facts": {
    "repository.contract.present": {
      "id": "repository.contract.present",
      "kind": "derived",
      "value": false,
      "claims": [
        {
          "kind": "derived",
          "value": false,
          "evidence": [
            {
              "source": "agent-ready.yaml",
              "detail": "not present"
            }
          ]
        }
      ],
      "corroboration": {
        "kinds": [
          "derived"
        ],
        "authorDeclared": false,
        "corroborated": false
      }
    },
    "repository.contract.valid": {
      "id": "repository.contract.valid",
      "kind": "unknown",
      "reason": "not-probed",
      "evidence": []
    },
    "repository.declarationSurface.present": {
      "id": "repository.declarationSurface.present",
      "kind": "derived",
      "value": true,
      "claims": [
        {
          "kind": "derived",
          "value": true,
          "evidence": [
            {
              "source": "AGENTS.md",
              "detail": "present"
            },
            {
              "source": ".github/copilot-instructions.md",
              "detail": "present"
            }
          ]
        }
      ],
      "corroboration": {
        "kinds": [
          "derived"
        ],
        "authorDeclared": false,
        "corroborated": false
      }
    },
    "repository.root": {
      "id": "repository.root",
      "kind": "derived",
      "value": ".",
      "claims": [
        {
          "kind": "derived",
          "value": ".",
          "evidence": [
            {
              "source": ".git",
              "detail": "nearest ancestor directory containing a .git entry"
            }
          ]
        }
      ],
      "corroboration": {
        "kinds": [
          "derived"
        ],
        "authorDeclared": false,
        "corroborated": false
      }
    }
  },
  "summary": {
    "facts": 4,
    "known": 3,
    "unknown": 1,
    "conflicts": 0,
    "complete": true
  },
  "diagnostics": []
}
`;

const SURFACE = "repository.declarationSurface.present";

function fixtureRepo() {
  return repoWith({ "AGENTS.md": "# agents\n", ".github/copilot-instructions.md": "# ci\n" });
}

/**
 * Two probes disagreeing about one fact. Contradiction preservation has to be
 * demonstrable without a repository domain, so it is driven by injected probes
 * here; Issue #37 supplies the real conflicting-signal case.
 */
function conflictingProbes(): readonly DiscoveryProbe[] {
  return [
    claimingValue("signals-a", SURFACE, "declared", "one", "signals-a.json"),
    claimingValue("signals-b", SURFACE, "derived", "two", "signals-b.json"),
  ];
}

describe("discover --json", () => {
  it("emits the documented snapshot byte for byte", async () => {
    const outcome = await runDiscover(fixtureRepo(), { json: true, root: "/repo" });
    expect(outcome.stdout).toBe(EXPECTED_SNAPSHOT);
  });

  it("carries an explicit snapshot version independent of the contract version", async () => {
    const outcome = await runDiscover(fixtureRepo(), { json: true, root: "/repo" });
    const parsed = JSON.parse(outcome.stdout) as Record<string, unknown>;
    expect(parsed["snapshotVersion"]).toBe(0);
    // The v1 contract version is a different concept and must not appear here.
    expect(parsed).not.toHaveProperty("version");
  });

  it("is byte-identical across repeated runs", async () => {
    const first = await runDiscover(fixtureRepo(), { json: true, root: "/repo" });
    const second = await runDiscover(fixtureRepo(), { json: true, root: "/repo" });
    expect(second.stdout).toBe(first.stdout);
  });

  it("reports a conflict in the snapshot without choosing a value", async () => {
    const outcome = await runDiscover(fixtureRepo(), {
      json: true,
      root: "/repo",
      probes: conflictingProbes(),
    });
    const parsed = JSON.parse(outcome.stdout) as {
      facts: Record<string, Record<string, unknown>>;
      summary: { conflicts: number };
    };
    const fact = parsed.facts[SURFACE] ?? {};
    expect(fact).not.toHaveProperty("value");
    expect(fact["claims"]).toHaveLength(2);
    expect(parsed.summary.conflicts).toBe(1);
  });
});

describe("discover human output", () => {
  it("reports evidence without scoring or judging the repository", async () => {
    const outcome = await runDiscover(fixtureRepo(), { json: false, root: "/repo" });
    expect(outcome.stdout).toBe(
      [
        "Agent-Ready repository discovery",
        "",
        "Repository",
        "  Root       /repo",
        "",
        "Agent-Ready contract",
        "  Present    no",
        "  Valid      unknown (not-probed)",
        "",
        "Repository signals",
        "  Surfaces   yes",
        "",
        "Discovery",
        "  Facts      4",
        "  Known      3",
        "  Unknown    1",
        "  Conflicts  0",
        "  Complete   yes",
        "",
      ].join("\n"),
    );
    // No readiness score, maturity ranking, or recommendation.
    expect(outcome.stdout).not.toMatch(/score|rating|maturity|recommend|should/i);
  });

  it("shows the retained claims when sources disagree", async () => {
    const outcome = await runDiscover(fixtureRepo(), {
      json: false,
      root: "/repo",
      probes: conflictingProbes(),
    });
    expect(outcome.stdout).toContain("Surfaces   conflicting");
    expect(outcome.stdout).toContain("Evidence");
    expect(outcome.stdout).toContain("declared");
    expect(outcome.stdout).toContain("derived");
    expect(outcome.stdout).toContain("DISCOVERY_FACT_CONFLICT");
  });
});

describe("discover error semantics", () => {
  it("succeeds in a repository with no contract, unlike the shipped commands", async () => {
    const outcome = await runDiscover(repoWith({ "AGENTS.md": "# agents\n" }), {
      json: false,
      root: "/repo",
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain("Present    no");
    expect(outcome.stdout).not.toContain("CONTRACT_NOT_FOUND");
  });

  it("leaves the v1 contract-not-found behaviour intact for validate", async () => {
    const outcome = await runValidate(
      repoWith({ "AGENTS.md": "# agents\n" }),
      { json: false },
      "/repo",
    );
    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.stderr).toContain("CONTRACT_NOT_FOUND");
  });

  it("keeps a usable partial snapshot successful when a probe fails", async () => {
    const fs = new FaultyFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/AGENTS.md", "# agents\n");
    fs.failOn("/repo/AGENTS.md");
    const outcome = await runDiscover(fs, { json: false, root: "/repo" });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain("Complete   no");
    expect(outcome.stdout).toContain("DISCOVERY_PARTIAL");
  });

  it("fails only when no readable root exists", async () => {
    const outcome = await runDiscover(repoWith({}), { json: false, root: "/repo/missing" });
    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.stderr).toContain("DISCOVERY_ROOT_UNREADABLE");
  });

  it("emits a JSON diagnostic envelope when discovery cannot run", async () => {
    const outcome = await runDiscover(repoWith({}), { json: true, root: "/repo/missing" });
    const parsed = JSON.parse(outcome.stdout) as {
      ok: boolean;
      diagnostics: { code: string; severity: string }[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics[0]?.code).toBe("DISCOVERY_ROOT_UNREADABLE");
  });

  it("reports a value-shaped probe that found no value as incomplete, not as a value", async () => {
    const outcome = await runDiscover(repoWith({}), {
      json: false,
      root: "/repo",
      probes: [
        probeReporting("valueless", SURFACE, "value", "declared", {
          status: "found",
          evidence: [{ source: "signals.json" }],
        }),
      ],
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain("unknown (probe-failed)");
    expect(outcome.stdout).toContain("DISCOVERY_PARTIAL");
  });
});

describe("discover read-only surface", () => {
  it("never writes, with or without a contract present", async () => {
    const fs = new RecordingFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/agent-ready.yaml", "version: 1\nproject:\n  name: x\n");
    fs.addFile("/repo/AGENTS.md", "# agents\n");
    await runDiscover(fs, { json: true, root: "/repo" });
    expect(fs.mutatingCalls()).toEqual([]);
  });

  it("reads only through the file-system boundary", async () => {
    const fs = new RecordingFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/AGENTS.md", "# agents\n");
    await runDiscover(fs, { json: true, root: "/repo" });
    expect(fs.calls.every((call) => call.startsWith("stat:") || call.startsWith("read:"))).toBe(
      true,
    );
  });
});
