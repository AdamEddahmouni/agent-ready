/**
 * Integration points the discovery feature touches outside its own directory.
 *
 * Each block pins a property that spans two components, so a regression is
 * attributed to the seam rather than to either side of it: the shared
 * diagnostic registry, the `explain` registry, exit-code resolution, and the
 * two renderings. The v1 behaviour these seams also serve is asserted
 * unchanged, so a discovery change can never quietly move it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDiscover } from "../../src/cli/commands/discover.js";
import { runExplain } from "../../src/cli/commands/explain.js";
import { EXPLANATION_REGISTRY } from "../../src/cli/commands/explainRegistry.js";
import {
  DIAGNOSTIC_CODES,
  WARNING_DIAGNOSTIC_CODES,
  isDiagnosticCode,
  isWarningDiagnosticCode,
} from "../../src/diagnostics/codes.js";
import type { DiagnosticCode } from "../../src/diagnostics/codes.js";
import { ExitCode, resolveExitCode } from "../../src/diagnostics/exitCodes.js";
import type { DiscoveryProbe } from "../../src/discover/probe.js";
import { claimingValue, FaultyFileSystem, repoWith } from "./discoverTestDoubles.js";

const DISCOVERY_CODES = DIAGNOSTIC_CODES.filter((code) => code.startsWith("DISCOVERY_"));

describe("the DISCOVERY_ namespace is registered in the shared registry", () => {
  it("adds only the five codes ADR-0044 defines", () => {
    expect(DISCOVERY_CODES).toEqual([
      "DISCOVERY_ROOT_UNREADABLE",
      "DISCOVERY_PARTIAL",
      "DISCOVERY_FACT_CONFLICT",
      "DISCOVERY_NO_SIGNALS",
      "DISCOVERY_FACT_UNSUPPORTED",
    ]);
  });

  it("is recognized by isDiagnosticCode and by explain's own validation", async () => {
    for (const code of DISCOVERY_CODES) {
      expect(isDiagnosticCode(code)).toBe(true);
    }
    const outcome = await runExplain(repoWith({}), { json: false, code: "DISCOVERY_PARTIAL" });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("appends rather than reorders, so the v1 code list is untouched", () => {
    const v1 = DIAGNOSTIC_CODES.filter((code) => !code.startsWith("DISCOVERY_"));
    // The discovery codes are strictly a suffix: nothing v1 moved.
    expect(DIAGNOSTIC_CODES.slice(0, v1.length)).toEqual(v1);
    expect(new Set(DIAGNOSTIC_CODES).size).toBe(DIAGNOSTIC_CODES.length);
  });
});

describe("severity is declared once, in the shared registry", () => {
  it("agrees with the pre-existing v1 warning codes", () => {
    // The three v1 informational codes must keep the severity they always had.
    for (const code of [
      "ADAPTER_NOT_YET_IMPLEMENTED",
      "VERIFICATION_NOT_DECLARED",
      "RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED",
    ] as const) {
      expect(isWarningDiagnosticCode(code)).toBe(true);
    }
  });

  it("treats only DISCOVERY_ROOT_UNREADABLE as an error", () => {
    for (const code of DISCOVERY_CODES) {
      expect(isWarningDiagnosticCode(code)).toBe(
        code === "DISCOVERY_ROOT_UNREADABLE" ? false : true,
      );
    }
  });

  it("lists only real codes", () => {
    for (const code of WARNING_DIAGNOSTIC_CODES) {
      expect(isDiagnosticCode(code)).toBe(true);
    }
  });

  it("explains every discovery code with the severity it is actually emitted at", async () => {
    // The defect this pins: `explain` used to restate the warning list, so a
    // newly registered informational code was reported as an error.
    for (const code of DISCOVERY_CODES) {
      const outcome = await runExplain(repoWith({}), { json: true, code });
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      const body = JSON.parse(outcome.stdout) as { severity: string; what: string };
      expect(body.severity).toBe(isWarningDiagnosticCode(code) ? "warning" : "error");
      expect(body.what.length).toBeGreaterThan(0);
    }
  });

  it("agrees with the severity discovery actually emits", async () => {
    // A conflict and an empty repository are both warnings on the wire, so
    // explain must not contradict the diagnostics the command produced.
    const conflicting = await runDiscover(repoWith({ "AGENTS.md": "# agents\n" }), {
      json: true,
      root: "/repo",
      probes: conflictingProbes(),
    });
    const emitted = JSON.parse(conflicting.stdout) as {
      diagnostics: { code: string; severity: string }[];
    };
    expect(emitted.diagnostics.map((d) => d.code)).toContain("DISCOVERY_FACT_CONFLICT");
    for (const diagnostic of emitted.diagnostics) {
      expect(diagnostic.severity).toBe(
        isWarningDiagnosticCode(diagnostic.code as DiagnosticCode) ? "warning" : "error",
      );
    }

    const empty = await runDiscover(repoWith({}), { json: true, root: "/repo" });
    const emptyBody = JSON.parse(empty.stdout) as {
      diagnostics: { code: string; severity: string }[];
    };
    expect(emptyBody.diagnostics.map((d) => d.code)).toEqual(["DISCOVERY_NO_SIGNALS"]);
    expect(emptyBody.diagnostics[0]?.severity).toBe("warning");
  });
});

describe("the explanation registry stays in step with the code registry", () => {
  it("has exactly one entry per code, so no identifier is duplicated", () => {
    expect(EXPLANATION_REGISTRY.size).toBe(DIAGNOSTIC_CODES.length);
  });

  it("gives every discovery code a non-empty explanation", () => {
    for (const code of DISCOVERY_CODES) {
      const entry = EXPLANATION_REGISTRY.get(code);
      expect(entry, `Missing explanation for ${code}`).toBeDefined();
      expect(entry?.what.length ?? 0).toBeGreaterThan(0);
      expect(entry?.why.length ?? 0).toBeGreaterThan(0);
      expect(entry?.fix.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("only ever cross-references codes that explain itself accepts", () => {
    // Otherwise `explain` would print a "Related codes" entry that its own
    // --code validation rejects.
    for (const [code, entry] of EXPLANATION_REGISTRY) {
      for (const related of entry.related ?? []) {
        expect(isDiagnosticCode(related), `${code} relates to unknown code ${related}`).toBe(true);
        expect(EXPLANATION_REGISTRY.has(related), `${code} relates to unexplained ${related}`).toBe(
          true,
        );
      }
    }
  });

  it("resolves deterministically and identically on repeated calls", async () => {
    const first = await runExplain(repoWith({}), { json: true, code: "DISCOVERY_FACT_CONFLICT" });
    const second = await runExplain(repoWith({}), { json: true, code: "DISCOVERY_FACT_CONFLICT" });
    expect(second.stdout).toBe(first.stdout);
    // Human rendering is stable too.
    const human = await runExplain(repoWith({}), { json: false, code: "DISCOVERY_FACT_CONFLICT" });
    const humanAgain = await runExplain(repoWith({}), {
      json: false,
      code: "DISCOVERY_FACT_CONFLICT",
    });
    expect(humanAgain.stdout).toBe(human.stdout);
  });

  it("still rejects an unknown code the way it always has", async () => {
    const outcome = await runExplain(repoWith({}), { json: true, code: "DISCOVERY_NOT_A_CODE" });
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    expect(outcome.stderr).toContain("unknown diagnostic code");
    expect(outcome.stdout).toBe("");
  });

  it("does not wire discovery backwards into any v1 explanation", () => {
    // A v1 explanation may not start pointing at a vNext code: that would make
    // the frozen surface depend on a parallel track.
    for (const [code, entry] of EXPLANATION_REGISTRY) {
      if (code.startsWith("DISCOVERY_")) continue;
      for (const related of entry.related ?? []) {
        expect(related.startsWith("DISCOVERY_"), `${code} relates to ${related}`).toBe(false);
      }
    }
  });

  it("keeps every v1 code resolvable with unchanged identity and severity", () => {
    const v1 = DIAGNOSTIC_CODES.filter((code) => !code.startsWith("DISCOVERY_"));
    const v1Warning = WARNING_DIAGNOSTIC_CODES.filter((code) => !code.startsWith("DISCOVERY_"));
    // Exactly the five codes v1 shipped as informational, unchanged.
    expect([...v1Warning]).toEqual([
      "ADAPTER_NOT_YET_IMPLEMENTED",
      "VERIFICATION_NOT_DECLARED",
      "RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED",
      "UPGRADE_NO_CHANGES_NEEDED",
      "UPGRADE_MANUAL_REVIEW_REQUIRED",
    ]);
    for (const code of v1) {
      expect(EXPLANATION_REGISTRY.has(code), `v1 code ${code} lost its explanation`).toBe(true);
    }
  });
});

describe("the diagnostics specification documents every registered code", () => {
  const spec = readFileSync(join(process.cwd(), "docs", "specification", "diagnostics.md"), "utf8");

  it("gives every code in the registry a row in the reference table", () => {
    // The table is the published contract; a code that reaches the registry
    // without a row here would be undocumented for every CI consumer.
    for (const code of DIAGNOSTIC_CODES) {
      expect(spec.includes(`\`${code}\``), `${code} has no row in diagnostics.md`).toBe(true);
    }
  });

  it("documents no code that the registry does not define", () => {
    // Guards the reverse direction: a stale row left behind by a rename, or a
    // code invented in prose. The allowlist is only the non-code identifiers
    // the reference legitimately names.
    const allowlist = new Set(["DISCOVERY_", "PATH", "WARNING_DIAGNOSTIC_CODES"]);
    const documented = new Set(
      [...spec.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((match) => match[1] ?? ""),
    );
    const known = new Set<string>(DIAGNOSTIC_CODES);
    const undocumented = [...documented].filter((code) => !known.has(code) && !allowlist.has(code));
    expect(
      undocumented,
      `diagnostics.md names identifiers the registry does not define: ${undocumented.join(", ")}`,
    ).toEqual([]);
  });

  it("has a detail section for each discovery code", () => {
    for (const code of DISCOVERY_CODES) {
      expect(spec.includes(`### \`${code}\``), `${code} has no detail section`).toBe(true);
    }
  });

  it("states the discovery severity and exit-code contract in the spec", () => {
    // The two facts most likely to be misread from the code alone.
    expect(spec).toContain("`DISCOVERY_PARTIAL`");
    expect(spec).toMatch(/exits `2`/);
    expect(spec).toContain("Stated deviations from ADR-0044");
  });
});

describe("exit-code resolution for the one fatal discovery condition", () => {
  it("reports an unreadable root as an input that could not be used, not a validation failure", () => {
    // Same category as GIT_REPOSITORY_NOT_FOUND and CONTRACT_READ_FAILED: a
    // location was asked for and could not be used. Nothing was validated.
    expect(
      resolveExitCode([
        {
          code: "DISCOVERY_ROOT_UNREADABLE",
          severity: "error",
          summary: "x",
        },
      ]),
    ).toBe(ExitCode.CONTRACT_NOT_FOUND);
  });

  it("keeps partial discovery successful", () => {
    expect(
      resolveExitCode([
        { code: "DISCOVERY_PARTIAL", severity: "warning", summary: "x" },
        { code: "DISCOVERY_FACT_CONFLICT", severity: "warning", summary: "x" },
        { code: "DISCOVERY_NO_SIGNALS", severity: "warning", summary: "x" },
      ]),
    ).toBe(ExitCode.SUCCESS);
  });

  it("does not move any v1 code's exit code", () => {
    expect(resolveExitCode([{ code: "CONTRACT_NOT_FOUND", severity: "error", summary: "x" }])).toBe(
      ExitCode.CONTRACT_NOT_FOUND,
    );
    expect(
      resolveExitCode([{ code: "CONTRACT_SCHEMA_INVALID", severity: "error", summary: "x" }]),
    ).toBe(ExitCode.VALIDATION_FAILED);
    expect(
      resolveExitCode([{ code: "CONTRACT_VERSION_UNSUPPORTED", severity: "error", summary: "x" }]),
    ).toBe(ExitCode.UNSUPPORTED_VERSION);
    expect(
      resolveExitCode([{ code: "INTERNAL_INVARIANT_VIOLATION", severity: "error", summary: "x" }]),
    ).toBe(ExitCode.INTERNAL_ERROR);
    expect(
      resolveExitCode([{ code: "GIT_REPOSITORY_NOT_FOUND", severity: "error", summary: "x" }]),
    ).toBe(ExitCode.CONTRACT_NOT_FOUND);
  });

  it("surfaces that code through the command surface, human and JSON alike", async () => {
    const human = await runDiscover(repoWith({}), { json: false, root: "/repo/missing" });
    expect(human.exitCode).toBe(ExitCode.CONTRACT_NOT_FOUND);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("DISCOVERY_ROOT_UNREADABLE");

    const json = await runDiscover(repoWith({}), { json: true, root: "/repo/missing" });
    expect(json.exitCode).toBe(ExitCode.CONTRACT_NOT_FOUND);
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: false });
  });

  it("still succeeds for a failed probe, which is not a fatal condition", async () => {
    const fs = new FaultyFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/AGENTS.md", "# agents\n");
    fs.failOn("/repo/AGENTS.md");
    const outcome = await runDiscover(fs, { json: false, root: "/repo" });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });
});

describe("the DISCOVERY_PARTIAL diagnostic names the path it could not inspect", () => {
  it("carries sourcePath so the remediation can point at a file", async () => {
    const fs = new FaultyFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/AGENTS.md", "# agents\n");
    fs.failOn("/repo/AGENTS.md");

    const outcome = await runDiscover(fs, { json: true, root: "/repo" });
    const body = JSON.parse(outcome.stdout) as {
      diagnostics: { code: string; sourcePath?: string; metadata?: Record<string, unknown> }[];
    };
    const partial = body.diagnostics.find((d) => d.code === "DISCOVERY_PARTIAL");
    expect(partial).toBeDefined();
    // The explain entry tells the reader to check the path in `sourcePath`;
    // without the field, that instruction points at nothing.
    expect(partial?.sourcePath).toBe("AGENTS.md");
    expect(partial?.metadata).toMatchObject({
      factId: "repository.declarationSurface.present",
    });
  });
});

const SURFACE = "repository.declarationSurface.present";

/**
 * The scenarios below need a fact with more than one claim, because corroboration
 * and contradiction cannot be shown with the production probe set alone — this
 * issue ships no repository domain. They are driven by injected probes, which is
 * the point: the substrate is demonstrable without a domain, so "the substrate
 * works" and "the first domain works" stay separately reviewable. Issue #37
 * supplies the real multi-source signals.
 */
function agreeingProbes() {
  return [
    claimingValue("signals-a", SURFACE, "declared", "agreed", "signals-a.json"),
    claimingValue("signals-b", SURFACE, "derived", "agreed", "signals-b.json"),
  ] as const;
}

function conflictingProbes() {
  return [
    claimingValue("signals-a", SURFACE, "declared", "one", "signals-a.json"),
    claimingValue("signals-b", SURFACE, "derived", "two", "signals-b.json"),
  ] as const;
}

function surfaceRepo() {
  return repoWith({ "AGENTS.md": "# agents\n" });
}

describe("the human rendering adds no claim the JSON snapshot does not contain", () => {
  // Each fact id and the human row that stands for it. The human rendering is
  // allowed to be terse; it is not allowed to be a different claim.
  const rows: Record<string, string> = {
    "repository.contract.present": "Present",
    "repository.contract.valid": "Valid",
    "repository.declarationSurface.present": "Surfaces",
  };

  const fixtures: Record<
    string,
    { fs: () => ReturnType<typeof repoWith>; probes?: readonly DiscoveryProbe[] }
  > = {
    "single-source repository": { fs: surfaceRepo },
    "corroborated repository": { fs: surfaceRepo, probes: agreeingProbes() },
    "conflicting repository": { fs: surfaceRepo, probes: conflictingProbes() },
    "empty repository": { fs: () => repoWith({}) },
  };

  it("shows every fact the snapshot reports, with its epistemic state", async () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      const args = { json: true, root: "/repo", ...(fixture.probes && { probes: fixture.probes }) };
      const json = await runDiscover(fixture.fs(), args);
      const body = JSON.parse(json.stdout) as {
        facts: Record<string, { kind: string; value?: unknown; reason?: string }>;
        summary: { facts: number };
        diagnostics: { code: string }[];
      };
      const human = await runDiscover(fixture.fs(), { ...args, json: false });
      const lines = human.stdout.split("\n");

      for (const [id, fact] of Object.entries(body.facts)) {
        if (id === "repository.root") {
          // Reported once, as the absolute root, rather than as a per-fact row.
          expect(human.stdout, name).toContain("Root");
          continue;
        }
        const label = rows[id];
        expect(label, `${name}: no human row declared for ${id}`).toBeDefined();
        if (label === undefined) continue;
        const row = lines.find((line) => line.startsWith(`  ${label}`));
        expect(row, `${name}: ${id} has no human row`).toBeDefined();
        if (fact.kind === "unknown") {
          // An unknown fact must never be rendered as a value. The reason is
          // carried through verbatim, so ignorance stays explainable.
          expect(row, `${name}: ${id}`).toContain(`unknown (${fact.reason ?? ""})`);
        } else if (!("value" in fact)) {
          expect(row, `${name}: ${id}`).toContain("conflicting");
        } else {
          expect(row, `${name}: ${id}`).not.toContain("unknown");
        }
      }

      // The counts in the human summary are the snapshot's own counts.
      expect(human.stdout, name).toContain(`Facts      ${String(body.summary.facts)}`);
      for (const diagnostic of body.diagnostics) {
        expect(human.stdout, `${name}: ${diagnostic.code}`).toContain(diagnostic.code);
      }
    }
  });

  it("prints an evidence block only for a fact that actually has several claims", async () => {
    const single = await runDiscover(surfaceRepo(), { json: false, root: "/repo" });
    expect(single.stdout).not.toContain("Evidence");

    const corroborated = await runDiscover(surfaceRepo(), {
      json: false,
      root: "/repo",
      probes: agreeingProbes(),
    });
    const evidenceBlocks = corroborated.stdout
      .split("\n")
      .filter((line) => line.trim() === "Evidence");
    expect(evidenceBlocks).toHaveLength(1);
  });

  it("indents a fact's evidence under that fact's own row", async () => {
    const outcome = await runDiscover(surfaceRepo(), {
      json: false,
      root: "/repo",
      probes: conflictingProbes(),
    });
    const lines = outcome.stdout.split("\n");
    const rowIndex = lines.findIndex((line) => line.startsWith("  Surfaces"));
    expect(rowIndex).toBeGreaterThanOrEqual(0);
    // The evidence block is the very next line, one level deeper, so it
    // cannot be read as corroborating the row above it.
    expect(lines[rowIndex + 1]).toBe("    Evidence");
    const cited = lines.slice(rowIndex + 2).filter((line) => line.startsWith("      "));
    expect(cited.length).toBeGreaterThan(0);
    for (const line of cited) {
      expect(line).toMatch(/^ {6}(author-declared|declared|derived)\s/);
    }
  });

  it("keeps each claim's citation inside that claim in the JSON rendering", async () => {
    const outcome = await runDiscover(surfaceRepo(), {
      json: true,
      root: "/repo",
      probes: conflictingProbes(),
    });
    const body = JSON.parse(outcome.stdout) as {
      facts: Record<
        string,
        { claims?: { kind: string; value: unknown; evidence: { source: string }[] }[] }
      >;
    };
    const fact = body.facts[SURFACE];
    expect(fact?.claims?.length).toBe(2);
    // A claim's evidence names the file that claim came from — the citation
    // cannot drift to a different claim's file.
    expect(fact?.claims?.map((claim) => claim.evidence[0]?.source)).toEqual([
      "signals-a.json",
      "signals-b.json",
    ]);
  });
});
