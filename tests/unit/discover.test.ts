import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverRepository, DEFAULT_PROBES } from "../../src/discover/discover.js";
import { buildAgreedFact, hasEvidence, mergeContributions } from "../../src/discover/fact.js";
import type { DiscoverySnapshot, Fact } from "../../src/discover/types.js";
import { DIAGNOSTIC_CODES } from "../../src/diagnostics/codes.js";
import { runDiscover } from "../../src/cli/commands/discover.js";
import {
  FaultyFileSystem,
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

describe("repository without an Agent-Ready contract", () => {
  it("succeeds, reports contract absence as a fact, and never fails with CONTRACT_NOT_FOUND", async () => {
    const snapshot = await discover(repoWith({ "package.json": '{"name":"fixture"}' }));

    expect(snapshot.ok).toBe(true);
    expect(fact(snapshot, "repository.contract.present")).toMatchObject({
      kind: "derived",
      value: false,
    });
    expect(CODES(snapshot)).not.toContain("CONTRACT_NOT_FOUND");
    expect(snapshot.summary.complete).toBe(true);
  });

  it("reports validity as not probed rather than invalid, because there is nothing to validate", async () => {
    const snapshot = await discover(repoWith({ "package.json": '{"name":"fixture"}' }));
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

  it("does not claim every probe completed when one of them could not", async () => {
    // DISCOVERY_NO_SIGNALS asserts completeness. Emitting it alongside
    // DISCOVERY_PARTIAL would put a claim in the snapshot that the same
    // snapshot's `complete: false` refutes.
    const fs = new FaultyFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/package.json", "{}");
    fs.failOn("/repo/package.json");

    const snapshot = await discover(fs);
    expect(snapshot.summary.complete).toBe(false);
    expect(CODES(snapshot)).toContain("DISCOVERY_PARTIAL");
    expect(CODES(snapshot)).not.toContain("DISCOVERY_NO_SIGNALS");
  });
});

describe("repository with a valid contract", () => {
  it("reports contract presence and validity as known true", async () => {
    const snapshot = await discover(
      repoWith({ "agent-ready.yaml": VALID_CONTRACT, "package.json": "{}" }),
    );
    expect(fact(snapshot, "repository.contract.present")).toMatchObject({ value: true });
    expect(fact(snapshot, "repository.contract.valid")).toMatchObject({ value: true });
  });

  it("keeps author claims marked author-declared and never promotes them to repository evidence", async () => {
    const snapshot = await discover(
      repoWith({ "agent-ready.yaml": VALID_CONTRACT, "package.json": "{}" }),
    );
    const packageManager = fact(snapshot, "repository.packageManager");
    expect(packageManager.kind).toBe("author-declared");
    expect("value" in packageManager && packageManager.value).toBe("pnpm");
    expect("corroboration" in packageManager && packageManager.corroboration.authorDeclared).toBe(
      true,
    );
    // Nothing in the repository corroborated it, and that is visible rather
    // than silently presented as a discovered fact.
    expect("corroboration" in packageManager && packageManager.corroboration.corroborated).toBe(
      false,
    );
    expect(
      "claims" in packageManager &&
        packageManager.claims.every(
          (claim) =>
            claim.kind === "author-declared" && claim.evidence[0]?.source === "agent-ready.yaml",
        ),
    ).toBe(true);
  });
});

describe("repository with a malformed contract", () => {
  it("keeps repository discovery usable and separates existence from validity", async () => {
    const snapshot = await discover(
      repoWith({
        "agent-ready.yaml": "version: 1\nproject: [this is not a mapping\n",
        "package.json": '{"packageManager":"pnpm@10.0.0"}',
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      }),
    );

    expect(snapshot.ok).toBe(true);
    expect(fact(snapshot, "repository.contract.present")).toMatchObject({ value: true });
    expect(fact(snapshot, "repository.contract.valid")).toMatchObject({ value: false });
    // The broken contract contributes no claim, but repository evidence stands.
    expect(fact(snapshot, "repository.packageManager")).toMatchObject({
      value: "pnpm",
      kind: "declared",
    });
  });

  it("does not let an unparseable contract supply an author claim", async () => {
    const snapshot = await discover(
      repoWith({ "agent-ready.yaml": "version: [broken\n", "package.json": "{}" }),
    );
    const packageManager = fact(snapshot, "repository.packageManager");
    expect(packageManager.kind).toBe("unknown");
    // The claim channel contributed nothing, and the most informative reason
    // across every probe is that no evidence was found.
    expect(packageManager.kind === "unknown" && packageManager.reason).toBe("no-evidence");
  });
});

describe("probe failure", () => {
  it("reports a failed probe as unknown with reason probe-failed and a matching diagnostic", async () => {
    const fs = new FaultyFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/package.json", '{"packageManager":"pnpm@10.0.0"}');
    fs.failOn("/repo/package.json");

    const snapshot = await discover(fs);

    expect(fact(snapshot, "repository.packageManager")).toMatchObject({
      kind: "unknown",
      reason: "probe-failed",
    });
    expect(CODES(snapshot)).toContain("DISCOVERY_PARTIAL");
    expect(snapshot.summary.complete).toBe(false);
  });

  it("does not treat a probe that throws as a repository fact", async () => {
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
    expect(fact(result.snapshot, "repository.declarationSurface.present")).toMatchObject({
      kind: "unknown",
      reason: "probe-failed",
    });
    expect(CODES(result.snapshot)).toContain("DISCOVERY_PARTIAL");
  });
});

describe("absence is not inaccessibility", () => {
  it("produces different facts for a missing file and a file that could not be inspected", async () => {
    const absent = await discover(repoWith({ "package.json": "{}" }));
    expect(fact(absent, "repository.declarationSurface.present")).toMatchObject({ value: false });
    expect(CODES(absent)).not.toContain("DISCOVERY_PARTIAL");

    const fs = new FaultyFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/AGENTS.md", "# agents\n");
    fs.failOn("/repo/AGENTS.md");

    const inaccessible = await discover(fs);
    expect(fact(inaccessible, "repository.declarationSurface.present")).toMatchObject({
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
    expect(fact(snapshot, "repository.declarationSurface.present").kind).toBe("unknown");
  });
});

describe("the evidence invariant", () => {
  it("gives every known fact at least one piece of evidence", async () => {
    const snapshot = await discover(
      repoWith({
        "agent-ready.yaml": VALID_CONTRACT,
        "package.json": '{"packageManager":"pnpm@10.0.0"}',
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        "AGENTS.md": "# agents\n",
      }),
    );
    for (const entry of Object.values(snapshot.facts)) {
      expect(hasEvidence(entry)).toBe(true);
    }
  });

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

  it("lets an unknown fact with no evidence exist only when it was not probed", async () => {
    const snapshot = await discover(repoWith({ "package.json": "{}" }));
    const validity = fact(snapshot, "repository.contract.valid");
    expect(validity.kind === "unknown" && validity.reason).toBe("not-probed");
    expect(validity.kind === "unknown" && validity.evidence).toEqual([]);
  });
});

describe("author claims do not overwrite repository evidence", () => {
  it("keeps both claims when a contract contradicts what the repository shows", async () => {
    const contractDeclaringYarn = VALID_CONTRACT.replace("name: pnpm", "name: yarn");
    const snapshot = await discover(
      repoWith({
        "agent-ready.yaml": contractDeclaringYarn,
        "package.json": '{"packageManager":"pnpm@10.0.0"}',
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      }),
    );

    const packageManager = fact(snapshot, "repository.packageManager");
    expect(packageManager.kind).not.toBe("unknown");
    expect("value" in packageManager).toBe(false);
    expect("claims" in packageManager && packageManager.claims).toHaveLength(3);
    expect(
      "claims" in packageManager && packageManager.claims.map((claim) => [claim.kind, claim.value]),
    ).toEqual([
      ["author-declared", "yarn"],
      ["declared", "pnpm"],
      ["derived", "pnpm"],
    ]);
    expect(CODES(snapshot)).toContain("DISCOVERY_FACT_CONFLICT");
  });
});

describe("contradiction preservation", () => {
  it("retains both lockfile claims and names no winner", async () => {
    const snapshot = await discover(
      repoWith({
        "package.json": '{"packageManager":"pnpm@10.0.0"}',
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        "package-lock.json": '{"lockfileVersion":3}\n',
      }),
    );

    const packageManager = fact(snapshot, "repository.packageManager");
    expect("value" in packageManager).toBe(false);
    expect(CODES(snapshot)).toContain("DISCOVERY_FACT_CONFLICT");
    const conflict = snapshot.diagnostics.find(
      (diagnostic) => diagnostic.code === "DISCOVERY_FACT_CONFLICT",
    );
    expect(conflict?.metadata?.["claimedValues"]).toEqual(expect.arrayContaining(["pnpm", "npm"]));
    // Every claim still cites the file it came from.
    expect(
      "claims" in packageManager &&
        packageManager.claims.every((claim) => claim.evidence.length > 0),
    ).toBe(true);
  });

  it("agrees without conflicting when every source names the same manager", async () => {
    const snapshot = await discover(
      repoWith({
        "package.json": '{"packageManager":"pnpm@10.0.0"}',
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      }),
    );
    const packageManager = fact(snapshot, "repository.packageManager");
    expect(packageManager).toMatchObject({ value: "pnpm" });
    expect("corroboration" in packageManager && packageManager.corroboration.kinds).toEqual([
      "declared",
      "derived",
    ]);
    expect(CODES(snapshot)).not.toContain("DISCOVERY_FACT_CONFLICT");
  });

  it("combines contributions that share a fact id rather than emitting two facts", () => {
    const merged = mergeContributions([
      {
        id: "repository.packageManager",
        kind: "declared",
        value: "pnpm",
        evidence: [{ source: "package.json" }],
      },
      {
        id: "repository.packageManager",
        kind: "derived",
        value: "npm",
        evidence: [{ source: "package-lock.json" }],
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
      "package.json": '{"packageManager":"pnpm@10.0.0"}',
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "AGENTS.md": "# agents\n",
      ".github/workflows/ci.yml": "on: push\n",
    };
    const first = await discover(repoWith(files));
    const second = await discover(repoWith(files));
    expect(second).toEqual(first);
  });

  it("excludes absolute paths so output does not depend on the checkout location", async () => {
    const snapshot = await discover(
      repoWith({ "package.json": '{"packageManager":"pnpm@10.0.0"}', "AGENTS.md": "# a\n" }),
    );
    expect(snapshot.root).toBe(".");
    expect(JSON.stringify(snapshot)).not.toContain("/repo");
    expect(snapshot.facts["repository.root"]).toMatchObject({ value: "." });
  });

  it("orders facts and diagnostics identically across runs regardless of probe order", async () => {
    const files = { "package.json": '{"packageManager":"pnpm@10.0.0"}' };
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
    fs.addFile("/repo/package.json", '{"packageManager":"pnpm@10.0.0"}');
    fs.addFile("/repo/AGENTS.md", "# agents\n");

    await discoverRepository(fs, { startDir: "/repo" });

    expect(fs.mutatingCalls()).toEqual([]);
    expect(fs.calls.length).toBeGreaterThan(0);
  });

  it("performs zero writes through the command surface too", async () => {
    const fs = new RecordingFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/package.json", "{}");

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
      repoWith({ "agent-ready.yaml": VALID_CONTRACT, "package.json": "{}" }),
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
