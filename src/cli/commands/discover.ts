import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../diagnostics/jsonRender.js";
import { resolveExitCode } from "../../diagnostics/exitCodes.js";
import type { FileSystem } from "../../filesystem/types.js";
import { discoverRepository } from "../../discover/discover.js";
import { compareCodeUnits } from "../../discover/ordering.js";
import {
  managerForLockfile,
  managerFromDeclaration,
} from "../../discover/packages/packageManager.js";
import type { DiscoveryProbe } from "../../discover/probe.js";
import type {
  DiscoverySnapshot,
  Fact,
  JsonValue,
  PackageEntry,
  WorkspaceCandidateEntry,
  WorkspaceDeclarationEntry,
} from "../../discover/types.js";
import type { CliOutcome } from "./validate.js";

export interface DiscoverArgs {
  readonly json: boolean;
  readonly root?: string;
  /** Test seam. Not reachable from the command line. */
  readonly probes?: readonly DiscoveryProbe[];
}

/**
 * Column width for package-manager rows. Wider than the other labels because a
 * scope is a path, and the longest label anyone should expect — `Manager (root)`
 * — has to fit without truncation.
 */
const MANAGER_LABEL_WIDTH = 15;

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

  lines.push("Agent-Ready contract");
  lines.push(...factRow("Present", snapshot.facts["repository.contract.present"]));
  lines.push(...factRow("Valid", snapshot.facts["repository.contract.valid"]));
  lines.push("");

  lines.push("Repository signals");
  lines.push(...factRow("Surfaces", snapshot.facts["repository.declarationSurface.present"]));
  lines.push("");

  lines.push("Packages");
  lines.push(...factRow("Count", snapshot.facts["repository.packages"], summarizePackages));
  lines.push(
    ...factRow("Manifests", firstPackageManifestFact(snapshot), summarizePackageManifests),
  );
  lines.push("");

  lines.push("Workspace");
  // Labelled `Manifest`, not `Root`: the value is the path of the manifest that
  // carries the declaration, and two rows reading `Root` in one output would be
  // ambiguous to a reader as well as to the test that renders every fact.
  lines.push(...factRow("Manifest", snapshot.facts["repository.workspace.root"]));
  lines.push(
    ...factRow(
      "Declared",
      snapshot.facts["repository.workspace.declarations"],
      summarizeDeclarations,
    ),
  );
  lines.push(
    ...factRow("Matched", snapshot.facts["repository.workspace.candidates"], summarizeCandidates),
  );
  lines.push(
    ...factRow("Members", snapshot.facts["repository.workspace.members"], summarizeMembers),
  );
  lines.push("");

  lines.push("Package manager");
  for (const line of renderPackageManagers(snapshot)) {
    lines.push(line);
  }
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
 * Renders every package-manager fact, root first and nested packages after.
 *
 * Scoped identities are rendered as their own rows rather than merged, because
 * merging them is precisely the flattening the model exists to prevent: a root
 * manifest naming pnpm beside a nested manifest naming npm is two true
 * statements, and printing one answer for both would make the snapshot lie
 * about a repository that is merely inconsistent.
 */
function renderPackageManagers(snapshot: DiscoverySnapshot): string[] {
  const ids = Object.keys(snapshot.facts)
    .filter((id) => id.startsWith("repository.packageManager."))
    .sort(compareCodeUnits);
  if (ids.length === 0) {
    return [row("Manager", "not probed")];
  }
  const lines: string[] = [];
  for (const id of ids) {
    const fact = snapshot.facts[id];
    if (fact === undefined) {
      continue;
    }
    const scope = id.slice("repository.packageManager.".length);
    // Labelled `Manager (root)` rather than plain `Root`: the repository root
    // is already a row in the section above, and two different rows reading
    // `Root` in one output is ambiguous to a person for the same reason it
    // broke the test that renders every fact.
    //
    // The label is allowed to exceed the column width rather than being
    // truncated. A truncated scope would name the wrong package, and a
    // mislabelled row is worse than a ragged one.
    lines.push(row(`Manager (${scope})`, describeManager(fact)));
    lines.push(...renderEvidence(fact, "    "));
  }
  return lines;
}

/**
 * One indented `label value` row.
 *
 * The label is padded to a column but never squeezed against the value.
 * `padEnd` returns a label longer than the column unchanged, which ran the value
 * straight into it — `Manager (packages/legacy)npm` — so a single space is
 * appended unconditionally. A long nested path therefore produces a ragged row
 * rather than an unreadable one, and a label is never truncated because a
 * truncated scope would name the wrong package.
 */
function row(label: string, value: string): string {
  return `  ${label.padEnd(MANAGER_LABEL_WIDTH)} ${value}`;
}

/**
 * Describes a package-manager fact without implying more certainty than the
 * snapshot holds.
 *
 * Three outcomes, three renderings. An incomplete fact — a declaration beside a
 * contradicting artifact — is rendered as `incomplete` with the contradicting
 * managers named, never as the declared value on its own: printing `pnpm` there
 * would present a contested answer as a settled one, which is the exact failure
 * the human renderer exists to prevent now that facts can carry structure.
 */
function describeManager(fact: Fact): string {
  if (fact.kind === "unknown") {
    return `unknown (${fact.reason})`;
  }
  if (!("value" in fact)) {
    const managers = distinctManagerNames(fact.claims.map((claim) => claim.value));
    return `conflicting (${managers.length > 0 ? managers.join(", ") : "no single value"})`;
  }
  if (fact.contradictedBy !== undefined) {
    const declared = managerNameOf(fact.value) ?? describeClaimValue(fact.value);
    // `contradictedBy` already holds manager names, so they are printed
    // directly rather than run back through `managerNameOf`. Passing them
    // through a function meant for claim values would yield nothing and print
    // "other evidence" in place of the actual disagreement.
    const others = fact.contradictedBy.filter(
      (value): value is string => typeof value === "string",
    );
    return `incomplete (${declared}; contradicted by ${others.length > 0 ? others.join(", ") : "other evidence"})`;
  }
  return managerNameOf(fact.value) ?? JSON.stringify(fact.value);
}

/**
 * The manager name a claim value indicates.
 *
 * A `declared` value is the field verbatim, so the name is the text before the
 * first `@`. A `derived` value is the **artifact path**, which for a workspace
 * member is nested (`packages/odd/yarn.lock`) while the signal table is keyed by
 * bare file name. The basename is therefore tried as well — without it, a
 * nested package's manager rendered as a raw quoted path, which is technically
 * accurate and useless to a reader.
 *
 * The merge already computed this projection internally; it is not published on
 * the fact, so it is recomputed here from the same two fixed rules rather than
 * carried through as a second source of truth.
 */
function managerNameOf(value: JsonValue): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const fromDeclaration = managerFromDeclaration(value);
  if (fromDeclaration !== undefined) {
    return fromDeclaration;
  }
  const asPath = managerForLockfile(value);
  if (asPath !== undefined) {
    return asPath;
  }
  const lastSeparator = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return lastSeparator < 0 ? undefined : managerForLockfile(value.slice(lastSeparator + 1));
}

function distinctManagerNames(values: readonly JsonValue[]): string[] {
  const names: string[] = [];
  for (const value of values) {
    const name = managerNameOf(value);
    if (name !== undefined && !names.includes(name)) {
      names.push(name);
    }
  }
  return names.sort(compareCodeUnits);
}

function summarizePackages(fact: Fact | undefined): string {
  if (fact === undefined) {
    return "not probed";
  }
  if (fact.kind === "unknown") {
    return `unknown (${fact.reason})`;
  }
  if (!("value" in fact)) {
    return "conflicting";
  }
  const entries = readEntries(fact.value);
  const named = entries.filter((entry) => entry.nameStatus === "declared").length;
  const unreadable = entries.filter((entry) => entry.manifestStatus !== "read").length;
  const parts = [String(entries.length)];
  if (named > 0) {
    parts.push(`${String(named)} named`);
  }
  if (unreadable > 0) {
    parts.push(`${String(unreadable)} unreadable`);
  }
  return parts.join(", ");
}

function summarizePackageManifests(fact: Fact | undefined): string {
  if (fact === undefined) {
    return "not probed";
  }
  if (fact.kind === "unknown") {
    return `unknown (${fact.reason})`;
  }
  if (!("value" in fact)) {
    return "conflicting";
  }
  return String(readEntries(fact.value).length);
}

function summarizeDeclarations(fact: Fact | undefined): string {
  if (fact === undefined) {
    return "not probed";
  }
  if (fact.kind === "unknown") {
    return `unknown (${fact.reason})`;
  }
  if (!("value" in fact)) {
    return "conflicting";
  }
  const declarations = readDeclarations(fact.value);
  if (declarations.length === 0) {
    return "none";
  }
  const unsupported = declarations.filter((entry) => entry.form === "unsupported").length;
  const patterns = declarations.reduce((total, entry) => total + entry.patterns.length, 0);
  const parts = [`${String(declarations.length)} source(s), ${String(patterns)} pattern(s)`];
  if (unsupported > 0) {
    parts.push(`${String(unsupported)} unsupported`);
  }
  return parts.join(", ");
}

function summarizeCandidates(fact: Fact | undefined): string {
  if (fact === undefined) {
    return "not probed";
  }
  if (fact.kind === "unknown") {
    return `unknown (${fact.reason})`;
  }
  if (!("value" in fact)) {
    return "conflicting";
  }
  const candidates = readCandidates(fact.value);
  const present = candidates.filter((entry) => entry.present === true).length;
  const missing = candidates.filter((entry) => entry.present === false).length;
  const unknown = candidates.filter((entry) => entry.present === null).length;
  const parts = [`${String(present)} present`];
  if (missing > 0) {
    parts.push(`${String(missing)} declared but absent`);
  }
  if (unknown > 0) {
    parts.push(`${String(unknown)} unreadable`);
  }
  return parts.join(", ");
}

function summarizeMembers(fact: Fact | undefined): string {
  if (fact === undefined) {
    return "not probed";
  }
  if (fact.kind === "unknown") {
    return `unknown (${fact.reason})`;
  }
  if (!("value" in fact)) {
    return "conflicting";
  }
  const members = readEntries(fact.value);
  const broken = members.filter((member) => member.manifestStatus !== "read").length;
  return broken === 0
    ? String(members.length)
    : `${String(members.length)} (${String(broken)} unreadable)`;
}

function firstPackageManifestFact(snapshot: DiscoverySnapshot): Fact | undefined {
  return snapshot.facts["repository.packages"];
}

/**
 * Reads a collection value defensively.
 *
 * The renderer must never crash and never print `[object Object]`, so a value
 * that is not the expected shape degrades to an empty list rather than being
 * stringified. A renderer that throws would take the whole human output down
 * over one malformed fact, and machine JSON — the canonical interface — would
 * still be fine, which is the wrong priority.
 *
 * The narrowing is by the one field every entry is required to have, and the
 * result is a *subset* of the original array typed as objects with that field.
 * A previous version filtered on "is a non-array object" and then asserted the
 * result to `PackageEntry[]`, which meant the renderer would happily read
 * `entry.nameStatus` off an object that had no such field and print `undefined`
 * as though the repository had said so. The two collection readers below add
 * the fields they actually read, so an entry missing one is dropped instead of
 * read.
 */
function readObjects(value: JsonValue): readonly Record<string, JsonValue>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is Record<string, JsonValue> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function readEntries(value: JsonValue): readonly PackageEntry[] {
  return readObjects(value).filter(
    (item): item is PackageEntry => typeof item["path"] === "string",
  );
}

function readCandidates(value: JsonValue): readonly WorkspaceCandidateEntry[] {
  return readObjects(value).filter(
    (item): item is WorkspaceCandidateEntry =>
      typeof item["path"] === "string" && typeof item["pattern"] === "string",
  );
}

function readDeclarations(value: JsonValue): readonly WorkspaceDeclarationEntry[] {
  return readObjects(value).filter(
    (item): item is WorkspaceDeclarationEntry => typeof item["source"] === "string",
  );
}

/**
 * One fact as a labelled row, followed by its corroborating claims when it has
 * any. Returns the row and its evidence as a unit so the two can never drift
 * apart in the output.
 *
 * The describer is a parameter rather than a single boolean renderer because
 * Issue #37 introduced value-shaped facts. Routing a list of packages through
 * a `typeof === "boolean"` check would either print `[object Object]` or invent
 * a yes/no for a collection, and both are worse than useless: the first looks
 * like a bug and the second is a false statement. Every fact kind therefore
 * names the renderer that knows how to describe it, so a new fact shape cannot
 * be added without someone deciding how a person reads it.
 *
 * Applied to whichever fact carries more than one claim, not to a hand-picked
 * fact id: a fact that later gains a second source must show its corroboration
 * without someone remembering to add it here, and evidence indented under its
 * own row can never be read as supporting a different row.
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
    lines.push(`${indent}  ${claim.kind.padEnd(15)} ${describeClaimValue(claim.value)}  ${where}`);
  }
  return lines;
}

/**
 * A claim's value, rendered as something a person can read.
 *
 * A claim value may be a manager declaration, a lockfile path, or — for the
 * collection facts — a whole list. `JSON.stringify` is the honest rendering for
 * all three: it is exact, it never produces `[object Object]`, and it does not
 * pretend a claim is simpler than it is. Prettifying it would risk a large
 * object being dumped into a narrow column.
 */
function describeClaimValue(value: JsonValue): string {
  return JSON.stringify(value);
}

function factRow(
  label: string,
  fact: Fact | undefined,
  describe: (fact: Fact | undefined) => string = describeBoolean,
): string[] {
  return [`  ${label.padEnd(11)}${describe(fact)}`, ...renderEvidence(fact, "    ")];
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
  if (fact.contradictedBy !== undefined) {
    return "incomplete";
  }
  if (typeof fact.value !== "boolean") {
    return JSON.stringify(fact.value);
  }
  return fact.value ? "yes" : "no";
}
