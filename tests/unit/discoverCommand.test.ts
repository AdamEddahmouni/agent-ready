import { describe, expect, it } from "vitest";
import { runDiscover } from "../../src/cli/commands/discover.js";
import { runValidate } from "../../src/cli/commands/validate.js";
import {
  FaultyFileSystem,
  RecordingFileSystem,
  repoWith,
  VALID_CONTRACT,
} from "./discoverTestDoubles.js";

/**
 * The canonical `--json` interface, asserted in full.
 *
 * This literal is the snapshot. Any accidental change to the output shape —
 * a renamed field, a re-ordered key, a silently dropped evidence entry — fails
 * here rather than surprising a consumer later. Issue #40 will formalize this
 * into a conformance corpus once the format stabilizes.
 *
 * Note `corroborated: false` on the three facts below that have exactly one
 * claim, while `repository.packageManager` — supported by two different files
 * — is `true`. `corroborated` means independent corroboration, not "something
 * other than the author's word appeared": a single source, however direct,
 * does not confirm itself.
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
      "value": false,
      "claims": [
        {
          "kind": "derived",
          "value": false,
          "evidence": [
            {
              "source": "AGENTS.md",
              "detail": "not present"
            },
            {
              "source": "CLAUDE.md",
              "detail": "not present"
            },
            {
              "source": ".cursorrules",
              "detail": "not present"
            },
            {
              "source": ".github/copilot-instructions.md",
              "detail": "not present"
            },
            {
              "source": ".github/workflows",
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
    "repository.packageManager": {
      "id": "repository.packageManager",
      "kind": "declared",
      "value": "pnpm",
      "claims": [
        {
          "kind": "declared",
          "value": "pnpm",
          "evidence": [
            {
              "source": "package.json",
              "pointer": "/packageManager",
              "detail": "declared as \\"pnpm@10.0.0\\""
            }
          ]
        },
        {
          "kind": "derived",
          "value": "pnpm",
          "evidence": [
            {
              "source": "pnpm-lock.yaml",
              "detail": "a pnpm lockfile is present"
            }
          ]
        }
      ],
      "corroboration": {
        "kinds": [
          "declared",
          "derived"
        ],
        "authorDeclared": false,
        "corroborated": true
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
    "facts": 5,
    "known": 4,
    "unknown": 1,
    "conflicts": 0,
    "complete": true
  },
  "diagnostics": []
}
`;

function fixtureRepo() {
  return repoWith({
    "package.json": '{"name":"fixture","packageManager":"pnpm@10.0.0"}',
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  });
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
    const conflicting = repoWith({
      "package.json": '{"packageManager":"pnpm@10.0.0"}',
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "package-lock.json": '{"lockfileVersion":3}\n',
    });
    const outcome = await runDiscover(conflicting, { json: true, root: "/repo" });
    const parsed = JSON.parse(outcome.stdout) as {
      facts: Record<string, Record<string, unknown>>;
      summary: { conflicts: number };
    };
    const packageManager = parsed.facts["repository.packageManager"] ?? {};
    expect(packageManager).not.toHaveProperty("value");
    expect(packageManager["claims"]).toHaveLength(3);
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
        "  Surfaces   no",
        "  Packages   pnpm",
        // Corroborating claims are indented under the fact they support, so
        // the citation can never be read as belonging to the row above.
        "    Evidence",
        '      declared        "pnpm"  package.json/packageManager',
        '      derived         "pnpm"  pnpm-lock.yaml',
        "",
        "Discovery",
        "  Facts      5",
        "  Known      4",
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
    const conflicting = repoWith({
      "package.json": '{"packageManager":"pnpm@10.0.0"}',
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "package-lock.json": '{"lockfileVersion":3}\n',
    });
    const outcome = await runDiscover(conflicting, { json: false, root: "/repo" });
    expect(outcome.stdout).toContain("Packages   conflicting");
    expect(outcome.stdout).toContain("Evidence");
    expect(outcome.stdout).toContain("declared");
    expect(outcome.stdout).toContain("derived");
    expect(outcome.stdout).toContain("DISCOVERY_FACT_CONFLICT");
  });
});

describe("discover error semantics", () => {
  it("succeeds in a repository with no contract, unlike the shipped commands", async () => {
    const fs = repoWith({ "package.json": "{}" });
    const outcome = await runDiscover(fs, { json: false, root: "/repo" });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain("Present    no");
    expect(outcome.stdout).not.toContain("CONTRACT_NOT_FOUND");
  });

  it("leaves the v1 contract-not-found behaviour intact for validate", async () => {
    const fs = repoWith({ "package.json": "{}" });
    const outcome = await runValidate(fs, { json: false }, "/repo");
    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.stderr).toContain("CONTRACT_NOT_FOUND");
  });

  it("keeps a usable partial snapshot successful when a probe fails", async () => {
    const fs = new FaultyFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/package.json", '{"packageManager":"pnpm@10.0.0"}');
    fs.failOn("/repo/package.json");
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
});

describe("discover read-only surface", () => {
  it("never writes, with or without a contract present", async () => {
    const fs = new RecordingFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/agent-ready.yaml", VALID_CONTRACT);
    fs.addFile("/repo/package.json", '{"packageManager":"pnpm@10.0.0"}');
    await runDiscover(fs, { json: true, root: "/repo" });
    expect(fs.mutatingCalls()).toEqual([]);
  });

  it("reads only through the file-system boundary", async () => {
    const fs = new RecordingFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/package.json", "{}");
    await runDiscover(fs, { json: true, root: "/repo" });
    expect(fs.calls.every((call) => call.startsWith("stat:") || call.startsWith("read:"))).toBe(
      true,
    );
  });
});
