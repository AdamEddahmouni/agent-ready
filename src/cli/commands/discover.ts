import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../diagnostics/jsonRender.js";
import { resolveExitCode } from "../../diagnostics/exitCodes.js";
import type { FileSystem } from "../../filesystem/types.js";
import { discoverRepository } from "../../discover/discover.js";
import type { DiscoveryProbe } from "../../discover/probe.js";
import type { DiscoverySnapshot, Fact } from "../../discover/types.js";
import type { CliOutcome } from "./validate.js";

export interface DiscoverArgs {
  readonly json: boolean;
  readonly root?: string;
  /** Test seam. Not reachable from the command line. */
  readonly probes?: readonly DiscoveryProbe[];
}

/**
 * `agent-ready discover` reports evidence about a repository. It does not
 * judge the repository: there is no score, no ranking, and no recommendation.
 *
 * Strictly read-only. Unlike `generate --write`, `init --write`, and
 * `verify --record`, this command exposes no mutation path at all, so there is
 * no `--write` or `--force` to add later without a new decision.
 *
 * For this command only, a missing `agent-ready.yaml` is repository
 * information rather than the fatal `CONTRACT_NOT_FOUND` the eleven shipped
 * commands treat it as. Partial knowledge still produces a usable snapshot and
 * a successful exit status; only the absence of a readable root is fatal.
 */
export async function runDiscover(fs: FileSystem, args: DiscoverArgs): Promise<CliOutcome> {
  const result = await discoverRepository(fs, {
    startDir: args.root ?? fs.cwd,
    ...(args.probes !== undefined && { probes: args.probes }),
  });

  if (!result.ok) {
    const exitCode = resolveExitCode(result.diagnostics);
    if (args.json) {
      return {
        exitCode,
        stdout:
          JSON.stringify(
            { ok: false, diagnostics: renderDiagnosticsJson(result.diagnostics) },
            null,
            2,
          ) + "\n",
        stderr: "",
      };
    }
    return { exitCode, stdout: "", stderr: renderDiagnosticsHuman(result.diagnostics) + "\n" };
  }

  const { snapshot, repoRoot } = result;
  const exitCode = resolveExitCode(snapshot.diagnostics);

  if (args.json) {
    return {
      exitCode,
      stdout: JSON.stringify(toJson(snapshot), null, 2) + "\n",
      stderr: "",
    };
  }

  return {
    exitCode,
    stdout: renderHuman(snapshot, repoRoot) + "\n",
    stderr: "",
  };
}

interface DiscoveryJson {
  readonly ok: true;
  readonly snapshotVersion: number;
  readonly root: string;
  readonly facts: Readonly<Record<string, unknown>>;
  readonly summary: DiscoverySnapshot["summary"];
  readonly diagnostics: ReturnType<typeof renderDiagnosticsJson>;
}

/**
 * `--json` is the canonical interface. It is a projection of the snapshot with
 * no facts added, dropped, or re-derived, so the two renderings can never
 * disagree about what was discovered.
 */
function toJson(snapshot: DiscoverySnapshot): DiscoveryJson {
  return {
    ok: true,
    snapshotVersion: snapshot.snapshotVersion,
    root: snapshot.root,
    facts: snapshot.facts,
    summary: snapshot.summary,
    diagnostics: renderDiagnosticsJson(snapshot.diagnostics),
  };
}

/**
 * The absolute root is printed because it is the one genuinely useful thing
 * about it for a person, and it comes from the caller's own working directory
 * rather than from the snapshot. The snapshot itself stays repository-relative
 * so its bytes do not depend on where the repository is checked out.
 */
function renderHuman(snapshot: DiscoverySnapshot, repoRoot: string): string {
  const lines: string[] = ["Agent-Ready repository discovery", ""];

  lines.push("Repository");
  lines.push(`  Root       ${repoRoot}`);
  lines.push("");

  const contractPresent = snapshot.facts["repository.contract.present"];
  const contractValid = snapshot.facts["repository.contract.valid"];
  lines.push("Agent-Ready contract");
  lines.push(...factRow("Present", contractPresent));
  lines.push(...factRow("Valid", contractValid));
  lines.push("");

  lines.push("Repository signals");
  lines.push(...factRow("Surfaces", snapshot.facts["repository.declarationSurface.present"]));
  lines.push("");

  const { facts, known, unknown, conflicts, complete } = snapshot.summary;
  lines.push("Discovery");
  lines.push(`  Facts      ${String(facts)}`);
  lines.push(`  Known      ${String(known)}`);
  lines.push(`  Unknown    ${String(unknown)}`);
  lines.push(`  Conflicts  ${String(conflicts)}`);
  lines.push(`  Complete   ${complete ? "yes" : "no"}`);

  if (snapshot.diagnostics.length > 0) {
    lines.push("", renderDiagnosticsHuman(snapshot.diagnostics));
  }
  return lines.join("\n");
}

/**
 * Prints every retained claim for a fact with its citation, so a value is
 * always accompanied by why it is believed and a conflict is visible as cited
 * sources rather than as an unexplained absence of an answer.
 *
 * Applied to whichever fact carries more than one claim, not to a
 * hand-picked fact id: a fact that later gains a second source must show its
 * corroboration without someone remembering to add it here, and evidence
 * indented under its own row can never be read as supporting a different row.
 */
function renderEvidence(fact: Fact | undefined, indent: string): string[] {
  if (fact === undefined || fact.kind === "unknown" || !("claims" in fact)) {
    return [];
  }
  if (fact.claims.length < 2) {
    return [];
  }
  const lines = [`${indent}Evidence`];
  for (const claim of fact.claims) {
    const first = claim.evidence[0];
    const where = first === undefined ? "unsourced" : `${first.source}${first.pointer ?? ""}`;
    lines.push(`${indent}  ${claim.kind.padEnd(15)} ${JSON.stringify(claim.value)}  ${where}`);
  }
  return lines;
}

/**
 * One fact as a labelled row, followed by its corroborating claims when it
 * has any. Returns the row and its evidence as a unit so the two can never
 * drift apart in the output.
 *
 * Every fact in this issue's vocabulary is boolean-shaped, so one describer
 * serves all of them. A value-shaped fact — Issue #37's first — needs its own
 * describer alongside this one rather than a `String(value)` fallback that
 * would print an object as `[object Object]`.
 */
function factRow(label: string, fact: Fact | undefined): string[] {
  return [`  ${label.padEnd(11)}${describeBoolean(fact)}`, ...renderEvidence(fact, "    ")];
}

/**
 * Renders a boolean-shaped fact. Only a real boolean is rendered as yes/no:
 * anything else is printed as the value it is, because answering "no" to a
 * value that is not `false` would be the exact kind of confident misreport the
 * snapshot exists to avoid.
 */
function describeBoolean(fact: Fact | undefined): string {
  if (fact === undefined) {
    return "not probed";
  }
  if (fact.kind === "unknown") {
    return `unknown (${fact.reason})`;
  }
  if (!("value" in fact)) {
    return "conflicting";
  }
  if (typeof fact.value !== "boolean") {
    return JSON.stringify(fact.value);
  }
  return fact.value ? "yes" : "no";
}
