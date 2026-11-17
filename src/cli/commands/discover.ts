import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../diagnostics/jsonRender.js";
import { resolveExitCode } from "../../diagnostics/exitCodes.js";
import type { FileSystem } from "../../filesystem/types.js";
import { discoverRepository } from "../../discover/discover.js";
import { compareCodeUnits } from "../../discover/ordering.js";
import { managerNameOfClaimValue } from "../../discover/packages/packageManager.js";
import { roleForScriptName } from "../../discover/commands/role.js";
import type { DiscoveryProbe } from "../../discover/probe.js";
import type {
  CommandEntry,
  DiscoverySnapshot,
  Fact,
  InvocationStatus,
  JsonValue,
  PackageCommandsEntry,
  PackageEntry,
  UnmodelledScriptEntry,
  VerificationEntrypointEntry,
  WorkspaceCandidateEntry,
  WorkspaceDeclarationEntry,
} from "../../discover/types.js";
import type { RepositoryGraph } from "../../discover/graph/types.js";
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
 * Column width for a command name, and the width a body may occupy.
 *
 * A body is truncated for the terminal only; the machine JSON always carries the
 * declared string verbatim, and a snapshot that is canonical and a display that
 * is readable are not allowed to disagree about what the repository said.
 */
const COMMAND_NAME_WIDTH = 18;
const ROLE_WIDTH = 7;
const ENTRYPOINT_LABEL_WIDTH = 22;
const BODY_WIDTH = 60;

/**
 * Longest a declared body may render in a terminal before it is elided.
 *
 * Deliberately a display limit and not a model limit. A shell command can be
 * arbitrarily long, and truncating it here while the JSON keeps it whole is the
 * only honest way to keep a terminal readable: the alternative is a summary
 * presented as though it were the declaration.
 */
function elideBody(body: string): string {
  const single = body.replace(/\s+/g, " ").trim();
  return single.length <= BODY_WIDTH ? single : `${single.slice(0, BODY_WIDTH - 1)}…`;
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
  /**
   * The repository graph, verbatim.
   *
   * Published in full because this is the machine interface: a consumer needs
   * every node, every edge, every provenance record, and every resolution
   * status, and none of them may depend on what a terminal chose to elide.
   */
  readonly graph: DiscoverySnapshot["graph"];
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
    graph: snapshot.graph,
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

  lines.push("Commands");
  lines.push(...renderCommands(snapshot));
  lines.push("");

  lines.push("Verification");
  lines.push(...renderVerification(snapshot));
  lines.push("");

  lines.push("Graph");
  lines.push(...renderGraph(snapshot));
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
 * Delegates to the single projection in `packages/packageManager.ts`, which
 * Issue #38 needed too: a command's derived executable is computed from a
 * package-manager fact, and a renderer carrying its own copy of that rule could
 * print one executable while the snapshot published another. One function, two
 * callers, no drift.
 */
function managerNameOf(value: JsonValue): string | undefined {
  return managerNameOfClaimValue(value);
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

/**
 * Renders every declared command, grouped by the package that declares it.
 *
 * Two things this section is careful not to do.
 *
 * It does not **infer**. A script whose name is not in the role grammar is
 * rendered with an em dash, because Agent-Ready did not classify it — not
 * because the repository is missing a test command. And the body is shown as
 * the declared string it is, so a reader can see that `test:watch` is `vitest`
 * and `test:package` is `pnpm build && …` for themselves.
 *
 * It does not **hide known absence**. A package with no `scripts` field, a
 * package with an empty one, and a package whose manifest could not be parsed
 * are three different states and get three different lines. The unreadable one
 * in particular must never be rendered as an empty list, which would assert a
 * package declares nothing when the truth is that nothing could be read.
 */
function renderCommands(snapshot: DiscoverySnapshot): string[] {
  const fact = snapshot.facts["repository.commands"];
  const lines = factRow("Declared", fact, describeCommandInventory);
  const entries = readPackageCommands(fact);
  if (entries.length === 0) {
    return lines;
  }
  lines.push("");
  for (const entry of entries) {
    lines.push(`  ${entry.packagePath}`);
    if (entry.scriptsStatus === "unobservable") {
      lines.push(`${COMMAND_INDENT}(manifest could not be interpreted)`);
      continue;
    }
    if (entry.scriptsStatus === "unsupported") {
      lines.push(`${COMMAND_INDENT}(scripts field in a form this version does not model)`);
      continue;
    }
    if (entry.commands.length === 0) {
      // Known empty, and the wording is load-bearing. "no declared scripts" is a
      // fact about the package. It is emphatically not a claim that the package
      // has no tests, which is a different and much stronger statement.
      lines.push(`${COMMAND_INDENT}(no declared scripts)`);
    }
    for (const command of entry.commands) {
      lines.push(commandRow(command.name, readCommandRole(command.name), command.body));
    }
    for (const unmodelled of entry.unmodelledScripts) {
      lines.push(
        `${COMMAND_INDENT}${unmodelled.name.padEnd(COMMAND_NAME_WIDTH)} ${"—".padEnd(ROLE_WIDTH)} not a command string`,
      );
    }
  }
  return lines;
}

/**
 * The command inventory's own epistemic state, rendered in one line.
 *
 * An `unknown` inventory reads as `unknown (reason)` rather than as zero, which
 * is the property the human renderer must never lose: "no package was found"
 * and "every package declares no scripts" are both "no commands appear below",
 * and only one of them is a fact about the repository.
 */
function describeCommandInventory(fact: Fact | undefined): string {
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
  const entries = readPackageCommands(fact);
  const scripts = entries.reduce((total, entry) => total + entry.commands.length, 0);
  return `${String(scripts)} script(s) in ${String(entries.length)} package(s)`;
}

const COMMAND_INDENT = "    ";

function commandRow(name: string, role: string | undefined, body: string | undefined): string {
  const roleCell = (role ?? "—").padEnd(ROLE_WIDTH);
  return `${COMMAND_INDENT}${name.padEnd(COMMAND_NAME_WIDTH)} ${roleCell} ${
    body === undefined ? "" : elideBody(body)
  }`.trimEnd();
}

/**
 * The role a *display* shows for a script name.
 *
 * The renderer's own call to the same grammar the snapshot used, rather than
 * reading a role back out of the entry. A command inventory entry is the
 * declaration and carries no role — roles live in the verification fact, by
 * design — so the human view derives the label with the identical published rule
 * instead of inventing a second one that could drift.
 */
function readCommandRole(name: string): string | undefined {
  return roleForScriptName(name)?.role;
}

/**
 * Renders the recognised verification entrypoints, grouped by package.
 *
 * Every wording here is chosen to avoid claiming a runtime result. Nothing was
 * executed, so nothing is "passed", "verified", or "working"; a command is
 * **declared**, an invocation is **available**, and where no invocation could be
 * derived the reason is named rather than papered over with a default
 * executable. Printing `npm run test` for a package whose manager is unknown
 * would be the single most misleading thing this command could do.
 */
function renderVerification(snapshot: DiscoverySnapshot): string[] {
  const fact = snapshot.facts["repository.verificationEntrypoints"];
  const lines = factRow("Entrypoints", fact, describeEntrypointCount);
  const requiredFact = snapshot.facts["repository.contract.verification"];
  const required = readContractVerification(requiredFact);
  // Prefixed with its epistemic source, because this row is a different *kind*
  // of answer from the ones above it. Reading a maintainer's list as a
  // repository finding is the exact confusion the separation exists to prevent,
  // and the label is the cheapest place to prevent it.
  lines.push(
    ...factRow("Required", requiredFact, (fact) =>
      required === undefined ? describeBoolean(fact) : `author-declared: ${required.join(", ")}`,
    ),
  );

  const entrypoints = readVerificationEntrypoints(fact);
  if (entrypoints.length === 0) {
    return lines;
  }
  lines.push("");
  for (const entry of entrypoints) {
    if (entry.first) {
      lines.push(`  ${entry.entry.packagePath}`);
    }
    lines.push(`${COMMAND_INDENT}${describeEntrypoint(entry.entry)}`);
  }
  return lines;
}

/**
 * The recognised-entrypoint count, in its own epistemic state.
 *
 * Zero rendered as `0` means "the roles were looked for and none matched" —
 * knowledge. It is deliberately not phrased as anything about whether the
 * repository has tests, because that is a different and much stronger claim.
 */
function describeEntrypointCount(fact: Fact | undefined): string {
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
  return String(readVerificationEntrypoints(fact).length);
}

function describeEntrypoint(entry: VerificationEntrypointEntry): string {
  // A namespaced entry is labelled `role (script)` so the reader can see which
  // declaration is being reported, and the two columns are separated by a
  // space rather than being padded against each other: a long namespaced label
  // produces a ragged row, never a run-together one.
  const label = entry.primary ? entry.role : `${entry.role} (${entry.script})`;
  const invocation = entry.invocation;
  if (invocation === null) {
    // The script, its role, and its body are all still known. Only the
    // invocation is missing, and the reason says which gap it is. No default
    // executable is printed: `npm run test` here would be a guess presented as
    // an answer.
    return `${label.padEnd(ENTRYPOINT_LABEL_WIDTH)} declared (${entry.script}); invocation unresolved — ${unresolvedReason(entry.invocationStatus)}`;
  }
  const command = `${invocation.executable} ${invocation.args.join(" ")}`;
  const location = invocation.cwd === "." ? command : `cwd=${invocation.cwd} · ${command}`;
  return `${label.padEnd(ENTRYPOINT_LABEL_WIDTH)} ${location}`;
}

function unresolvedReason(status: InvocationStatus): string {
  switch (status) {
    case "package-manager-conflict":
      return "package manager contested";
    case "package-manager-incomplete":
      return "package manager declaration contradicted";
    default:
      return "package manager unknown";
  }
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
 * Renders the graph as a summary, never as the graph itself.
 *
 * The human form is a *summary* of the same data the JSON carries in full, and
 * three rules keep it honest:
 *
 *  - It never implies more certainty than the snapshot holds. A workspace import
 *    that resolved to a *package* and not to a module is printed as
 *    `package`, not as `resolved`, because "resolved" would be a claim about a
 *    file that was never established.
 *  - It never hides a problem inside the JSON. Unresolved imports and unowned
 *    subjects get their own counts, and a bounded list of examples follows so a
 *    reader can see the actual condition rather than only its size.
 *  - It never scores. No "healthy", no "coverage score", no recommendation: a
 *    repository model that judges is a repository model that is wrong by
 *    opinion.
 */
function renderGraph(snapshot: DiscoverySnapshot): string[] {
  const graph = snapshot.graph;
  if (graph === null) {
    return factRow("Status", undefined, () => "not built (see the diagnostics below)");
  }
  const counts = graph.counts;
  const lines: string[] = [];
  lines.push(
    `  Nodes      ${String(counts.nodes)} (${String(counts.packages)} package, ${String(counts.modules)} module, ${String(counts.externalDependencies)} dependency, ${String(counts.owners)} owner)`,
  );
  lines.push(
    `  Edges      ${String(counts.edges)} (${String(counts.importEdges)} import, ${String(counts.dependencyEdges)} dependency, ${String(counts.edges - counts.importEdges - counts.dependencyEdges)} ownership)`,
  );
  lines.push(
    `  Imports    ${String(counts.resolvedImports)} resolved, ${String(counts.unresolvedImports)} unresolved`,
  );
  lines.push(
    `  Depend.    ${String(counts.dependencyEdges)} declared, ${String(counts.resolvedDependencies)} resolved from a lockfile, ${String(counts.workspaceDependencies)} workspace target(s) not found`,
  );
  lines.push(...ownershipRows(graph.ownership.status, graph.ownership.rules, counts));
  const universe = graph.sourceUniverse;
  // The resolution mode is omitted rather than printed empty when no tsconfig
  // declared one — a bounded walk over a repository with no `tsconfig.json`
  // genuinely has no mode, and printing `moduleResolution ` with nothing after
  // it reads as a value that failed to render.
  lines.push(
    `  Universe   ${universe.strategy} (${String(universe.files.length)} file(s)${
      universe.resolutionMode === "" ? "" : `, moduleResolution ${universe.resolutionMode}`
    })`,
  );
  lines.push(
    `  Complete   ${graph.complete ? "yes" : `no${graph.truncatedBy === null ? "" : ` — stopped at ${graph.truncatedBy}`}`}`,
  );
  const unresolved = readUnresolvedImports(graph);
  if (unresolved.length === 0) {
    return lines;
  }
  lines.push("");
  lines.push(`  Unresolved imports (${String(unresolved.length)})`);
  for (const example of unresolved.slice(0, MAX_UNRESOLVED_EXAMPLES)) {
    lines.push(`${COMMAND_INDENT}${example}`);
  }
  const remaining = unresolved.length - MAX_UNRESOLVED_EXAMPLES;
  if (remaining > 0) {
    lines.push(
      `${COMMAND_INDENT}+ ${String(remaining)} more; every one is in the JSON with its file, line, and reason`,
    );
  }
  return lines;
}

/** The ownership counts, distinguishing the four states a reader must not confuse. */
function ownershipRows(
  status: RepositoryGraph["ownership"]["status"],
  rules: number,
  counts: RepositoryGraph["counts"],
): string[] {
  const owned = `owned ${String(counts.ownedSubjects)}, unowned ${String(counts.unownedSubjects)}`;
  if (status === "absent") {
    // "No CODEOWNERS file" and "every file is unowned" are different answers,
    // and printing only the second would make a repository without an
    // ownership policy look like a repository whose policy declined to match.
    return [`  Ownership  no CODEOWNERS file found; ${owned}`];
  }
  if (status === "unreadable" || status === "unsupported") {
    return [`  Ownership  ${status}; ${owned}`];
  }
  return [`  Ownership  ${String(rules)} rule(s) in the ownership surface; ${owned}`];
}

/**
 * One `path:line  "specifier"` line per unresolved import, code-unit ordered.
 *
 * Narrowed defensively for the same reason every other reader in this file is:
 * a renderer that trusted a missing field would print `undefined` as though the
 * repository had written it.
 */
function readUnresolvedImports(graph: RepositoryGraph): string[] {
  const lines: string[] = [];
  for (const edge of graph.edges) {
    if (edge.kind !== "imports" || edge.resolution.status !== "unresolved") {
      continue;
    }
    const line = edge.provenance.line;
    lines.push(
      `${edge.source.replace(/^module:/, "")}:${String(line)}  ${JSON.stringify(edge.specifier)} — ${edge.resolution.reason}`,
    );
  }
  return lines.sort(compareCodeUnits);
}

/**
 * How many unresolved imports the terminal names before deferring to the JSON.
 *
 * A display limit, not a model limit: the graph carries every one of them, and a
 * reader who needs the full list has it in `--json`. Flooding a terminal with
 * hundreds of lines is how a real finding gets scrolled past.
 */
const MAX_UNRESOLVED_EXAMPLES = 10;

/**
 * The per-package command inventories, narrowed defensively.
 *
 * Same reasoning as the readers above, extended to the nested shape: a renderer
 * that trusted a missing field would print `undefined` as though the repository
 * had said so. Each entry must carry the two fields the renderer actually reads
 * before its commands are looked at at all.
 */
function readPackageCommands(fact: Fact | undefined): readonly PackageCommandsEntry[] {
  if (fact === undefined || fact.kind === "unknown" || !("value" in fact)) {
    return [];
  }
  return readObjects(fact.value)
    .filter(
      (item): item is PackageCommandsEntry =>
        typeof item["packagePath"] === "string" &&
        Array.isArray(item["commands"]) &&
        Array.isArray(item["unmodelledScripts"]),
    )
    .map((entry) => ({
      ...entry,
      commands: readObjects(entry.commands).filter(
        (command): command is CommandEntry =>
          typeof command["name"] === "string" && typeof command["body"] === "string",
      ),
      unmodelledScripts: readObjects(entry.unmodelledScripts).filter(
        (item): item is UnmodelledScriptEntry => typeof item["name"] === "string",
      ),
    }));
}

interface DisplayedEntrypoint {
  readonly entry: VerificationEntrypointEntry;
  /** True on the first entry of its package, so the heading prints once. */
  readonly first: boolean;
}

function readVerificationEntrypoints(fact: Fact | undefined): readonly DisplayedEntrypoint[] {
  if (fact === undefined || fact.kind === "unknown" || !("value" in fact)) {
    return [];
  }
  const entries = readObjects(fact.value).filter(
    (item): item is VerificationEntrypointEntry =>
      typeof item["packagePath"] === "string" &&
      typeof item["script"] === "string" &&
      typeof item["role"] === "string" &&
      typeof item["body"] === "string",
  );
  let previousPackage: string | undefined;
  return entries.map((entry) => {
    const first = entry.packagePath !== previousPackage;
    previousPackage = entry.packagePath;
    return { entry, first };
  });
}

/**
 * The contract's author-declared verification sequence, or undefined when the
 * contract declares none.
 *
 * Returned in the order the maintainer wrote it, never sorted. This is the one
 * ordered list in the snapshot whose order is source semantics.
 */
function readContractVerification(fact: Fact | undefined): readonly string[] | undefined {
  if (fact === undefined || fact.kind === "unknown" || !("value" in fact)) {
    return undefined;
  }
  if (!Array.isArray(fact.value)) {
    return undefined;
  }
  return fact.value.filter((item): item is string => typeof item === "string");
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
  return [`  ${labelCell(label)}${describe(fact)}`, ...renderEvidence(fact, "    ")];
}

/** Width the fact-row labels are padded to. */
const FACT_LABEL_WIDTH = 11;

/**
 * Pads a label to the fact column, guaranteeing a separating space.
 *
 * `padEnd` returns a label that already fills the column unchanged, which ran the
 * value straight into it — `Entrypointsunknown (no-evidence)`. A row that has
 * run together is not a formatting nit: it is a rendering that reads as one
 * token, and a reader cannot see where the label ends and the repository's
 * answer begins. Long labels produce a ragged row rather than an unreadable one,
 * exactly as `row()` does for package-manager scopes.
 */
function labelCell(label: string): string {
  return label.length >= FACT_LABEL_WIDTH ? `${label} ` : label.padEnd(FACT_LABEL_WIDTH);
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
