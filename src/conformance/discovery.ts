/**
 * The conformance corpus for Discovery Snapshot Format 1.
 *
 * A **conformance corpus** is a set of repositories with fixed input trees and
 * expected discovery snapshots, used to decide whether an implementation
 * conforms to snapshot-version semantics. It exists to catch four specific
 * things, and the case list is chosen so that each is reachable:
 *
 * - **behaviour drift** — a field that changes meaning, or a shape that
 *   changes, without anyone deciding it should;
 * - **heuristic drift** — the resolvers, the role grammar, and the ownership
 *   matcher quietly producing something different;
 * - **ordering drift** — a sort key or a comparison changing, which byte
 *   comparison turns into a visible diff rather than a silent reordering;
 * - **provenance drift** — a citation that stops being true.
 *
 * The corpus is **fully local**. No case clones anything, and nothing here
 * reaches the network, a registry, or a model. That is a hard requirement, not
 * a convenience: a conformance suite that depends on an external repository's
 * availability is a suite that fails for reasons that have nothing to do with
 * the implementation, and one that runs against a floating branch cannot tell
 * a regression from an upstream change.
 *
 * The cases are **synthetic reductions** of conditions observed in fifteen
 * third-party repositories (see `docs/research/snapshot-v1-corpus-study.md`).
 * No third-party source is vendored: each case is the smallest tree that
 * exercises the semantics, and the real repository it came from is recorded in
 * the case metadata for traceability.
 *
 * Two axes are enforced here rather than left to convention:
 *
 * 1. **The comparison is byte-exact.** The snapshot is intentionally
 *    deterministic, so a canonical serialisation compared as bytes catches
 *    ordering changes, dropped fields, changed provenance, and semantic drift
 *    in one comparison. Nothing is normalised away; a field that is excluded
 *    from comparison is excluded by this module, explicitly, and nowhere else.
 * 2. **Every case declares its `snapshotVersion`.** A case cannot silently
 *    belong to a different format version, which is what makes a future
 *    `v2/` sibling directory possible.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { runDiscover } from "../cli/commands/discover.js";
import { compareCodeUnits } from "../discover/ordering.js";
import { InMemoryFileSystem } from "../filesystem/inMemoryFileSystem.js";

/** Where the corpus lives, relative to the repository root. */
export const CORPUS_ROOT = "conformance/discovery";

/** The snapshot version this module knows how to check. */
export const CORPUS_SNAPSHOT_VERSION = 1;

/**
 * What a case asserts.
 *
 * - `normative` — the output is correct, and a change to it is a decision
 *   somebody has to make.
 * - `known-inaccurate` — the output is **wrong on purpose**. It pins a
 *   limitation the project knows about, so that closing the limitation shows
 *   up as a visible diff instead of passing unnoticed forever. Conformance
 *   means "still produces the recorded inaccuracy", never "is correct".
 * - `unsupported` — the case exists to prove that a construct this version
 *   declines is reported as declined rather than guessed at.
 *
 * The distinction between `normative` and `known-inaccurate` is the whole
 * point of the corpus, so it is a machine-readable field rather than a sentence
 * in a README that tooling cannot read.
 */
export type CorpusStatus = "normative" | "known-inaccurate" | "unsupported";

export interface CorpusCaseMetadata {
  /** Directory name, and the case's name. */
  readonly name: string;
  /** One line: what this case is for. */
  readonly purpose: string;
  /** Which epistemic or structural shape it exercises. */
  readonly exercises: readonly string[];
  /** The snapshot version this case's expected output belongs to. */
  readonly snapshotVersion: number;
  readonly status: CorpusStatus;
  /** Set for `known-inaccurate`: why the recorded output is knowingly wrong. */
  readonly knownLimitation?: string;
  /** Set for `known-inaccurate`: what a correct implementation would do. */
  readonly correctFutureBehaviour?: string;
  /** Set when the case is reduced from a real repository. */
  readonly inspiredBy?: {
    readonly repository: string;
    readonly commit: string;
    readonly originalBehaviour: string;
  };
}

export interface CorpusCase {
  readonly metadata: CorpusCaseMetadata;
  /** Absolute path of the fixture repository. */
  readonly repoPath: string;
  /** Directory of the case, for reporting. */
  readonly casePath: string;
  /** The expected snapshot, byte for byte. */
  readonly expected: string;
}

/** Absolute path of the repository root this module is running inside. */
function projectRoot(): string {
  // The corpus is addressed relative to the repository root, which is where
  // `process.cwd()` is when tests, `pnpm test`, and the scripts all run. Every
  // consumer in this repository runs from the root, and a guess at "somewhere
  // above this file" would be a guess.
  return process.cwd();
}

function caseDirectories(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareCodeUnits);
}

/**
 * Validates one case's `metadata.json` content.
 *
 * Exported so tests can enforce the machine-readable contract without running
 * discovery, and so a maintainer gets the same errors the loader would raise.
 */
export function metadataValidationProblems(
  name: string,
  parsed: Partial<CorpusCaseMetadata>,
): string[] {
  const problems: string[] = [];
  if (parsed.name !== name) problems.push(`name must be "${name}"`);
  if (typeof parsed.purpose !== "string" || parsed.purpose.length === 0) {
    problems.push("purpose must be a non-empty string");
  }
  if (!Array.isArray(parsed.exercises) || parsed.exercises.length === 0) {
    problems.push("exercises must be a non-empty array");
  }
  if (parsed.snapshotVersion !== CORPUS_SNAPSHOT_VERSION) {
    problems.push(
      `snapshotVersion must be ${String(CORPUS_SNAPSHOT_VERSION)}, got ${JSON.stringify(parsed.snapshotVersion)}`,
    );
  }
  if (
    parsed.status !== "normative" &&
    parsed.status !== "known-inaccurate" &&
    parsed.status !== "unsupported"
  ) {
    problems.push(`status must be normative, known-inaccurate or unsupported`);
  }
  if (parsed.status === "known-inaccurate") {
    if (typeof parsed.knownLimitation !== "string" || parsed.knownLimitation.length === 0) {
      problems.push("a known-inaccurate case must state knownLimitation");
    }
    if (
      typeof parsed.correctFutureBehaviour !== "string" ||
      parsed.correctFutureBehaviour.length === 0
    ) {
      problems.push("a known-inaccurate case must state correctFutureBehaviour");
    }
  }
  return problems;
}

/** Reads the metadata every case must carry, and rejects a case that omits it. */
function readMetadata(casePath: string, name: string): CorpusCaseMetadata {
  const metadataPath = join(casePath, "metadata.json");
  if (!existsSync(metadataPath)) {
    throw new Error(
      `The conformance case "${name}" has no metadata.json. A case without ` +
        `machine-readable metadata cannot be checked, and prose in a README ` +
        `cannot be validated by tooling.`,
    );
  }
  const parsed = JSON.parse(readFileSync(metadataPath, "utf8")) as Partial<CorpusCaseMetadata>;
  const problems = metadataValidationProblems(name, parsed);
  if (problems.length > 0) {
    throw new Error(
      `The conformance case "${name}" has invalid metadata.json:\n  - ${problems.join("\n  - ")}`,
    );
  }
  return parsed as CorpusCaseMetadata;
}

/**
 * Every case in one snapshot version, code-unit sorted by name.
 *
 * `allowMissingExpected` exists for exactly one caller: `conformance:update`,
 * whose whole job is to create the file that `check` requires. Without it a new
 * case could never be added, because the tool that writes the expectation is the
 * tool that refuses to start without one.
 */
export function loadCorpus(
  version: number = CORPUS_SNAPSHOT_VERSION,
  options: { readonly allowMissingExpected?: boolean } = {},
): CorpusCase[] {
  const root = join(projectRoot(), CORPUS_ROOT, `v${String(version)}`);
  return caseDirectories(root).map((name) => {
    const casePath = join(root, name);
    const expectedPath = join(casePath, "expected.json");
    if (!existsSync(expectedPath) && options.allowMissingExpected !== true) {
      throw new Error(
        `The conformance case "${name}" has no expected.json. Run \`pnpm conformance:update\` ` +
          `to generate it, and review the diff: an expected output is a decision, not a default.`,
      );
    }
    return {
      metadata: readMetadata(casePath, name),
      repoPath: join(casePath, "repo"),
      casePath,
      expected: existsSync(expectedPath) ? readFileSync(expectedPath, "utf8") : "",
    };
  });
}

/** The versioned directory name for a snapshot version. */
export function corpusDirectoryName(version: number): string {
  return `v${String(version)}`;
}

// ---------------------------------------------------------------------------
// Running a case
// ---------------------------------------------------------------------------

/**
 * Builds the fixture repository in an in-memory filesystem.
 *
 * In-memory rather than on disk for three reasons. A committed `.git` entry is
 * impossible — git refuses to track the path — so a fixture on disk has no
 * repository boundary and discovery would walk up into *this* repository and
 * report on Agent-Ready instead of the fixture. In-memory also makes the
 * read-only guarantee structural rather than asserted: there is no writer
 * handed to the code under test, so a mutation attempt has nowhere to land. And
 * it removes the filesystem from the comparison, which is what lets the expected
 * output be identical on Windows, macOS and Linux.
 *
 * The `.git` directory is added so the root resolves exactly as it does in a
 * real checkout, rather than by falling back to the start directory.
 */
export function buildFixtureFileSystem(
  repoPath: string,
  options: { readonly exclude?: (path: string) => boolean } = {},
): InMemoryFileSystem {
  const fs = new InMemoryFileSystem("/repo");
  fs.addDirectory("/repo/.git");
  for (const path of walkFiles(repoPath)) {
    if (options.exclude?.(path) === true) continue;
    const content = readFileSync(join(repoPath, path), "utf8");
    fs.addFile(`/repo/${path}`, content);
  }
  return fs;
}

/** Every file under `root`, as `/`-separated relative paths, code-unit sorted. */
function walkFiles(root: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) =>
    compareCodeUnits(a.name, b.name),
  )) {
    const child = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...walkFiles(root, child));
    } else if (entry.isFile()) {
      found.push(child);
    }
  }
  return found;
}

/**
 * Runs discovery over a case and returns the canonical stdout the CLI would
 * write.
 *
 * `runDiscover` rather than `discoverRepository` on purpose: the contract is
 * the bytes a consumer actually receives, not an internal object that a
 * renderer might project differently. Comparing the internal type would let a
 * projection bug pass conformance, which is precisely the class of defect the
 * issue asks the schema to catch.
 */
export async function runCase(entry: CorpusCase): Promise<string> {
  const fs = buildFixtureFileSystem(entry.repoPath);
  const outcome = await runDiscover(fs, { json: true, root: "/repo" });
  if (outcome.stderr.length > 0) {
    throw new Error(
      `The conformance case "${entry.metadata.name}" wrote to stderr: ${outcome.stderr}`,
    );
  }
  return outcome.stdout;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Why a case did not conform, or an empty array when it did. */
export interface ConformanceFailure {
  readonly caseName: string;
  readonly reason: "drift" | "invalid-snapshot-version" | "unreadable-expected";
  readonly summary: string;
  /** A short, deterministic description of where the bytes diverge. */
  readonly detail: string;
}

export interface ConformanceResult {
  readonly name: string;
  readonly status: CorpusStatus;
  readonly schemaValid: boolean;
  readonly matched: boolean;
}

/**
 * A short, deterministic pointer at the first place two canonical snapshots
 * differ.
 *
 * Pretty JSON, compared as text, and the report names the JSON path rather than
 * dumping a coloured diff. A full line-by-line diff of a 40 000-line snapshot is
 * unreadable, and the maintainer who has to act on it is usually looking at a
 * single field that moved — so this points at that field, and says which side
 * has it.
 */
export function firstDifference(expected: string, actual: string): string {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const limit = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < limit; index++) {
    const left = expectedLines[index];
    const right = actualLines[index];
    if (left === right) continue;
    const at = jsonPathAt(expectedLines, index);
    if (left === undefined) {
      return `line ${String(index + 1)} (${at}): expected nothing, got ${JSON.stringify(right)}`;
    }
    if (right === undefined) {
      return `line ${String(index + 1)} (${at}): expected ${JSON.stringify(left)}, got nothing`;
    }
    return `line ${String(index + 1)} (${at}):\n      expected ${JSON.stringify(left)}\n      actual   ${JSON.stringify(right)}`;
  }
  return "the snapshots are byte-identical";
}

/**
 * The JSON path of the value on a given line of pretty-printed JSON.
 *
 * A best-effort reader, and deliberately so: it is a report, not a validator,
 * and reporting a slightly wrong path is better than reporting no location at
 * all. It walks the indentation of the lines above the target and keeps the keys
 * and indices it can see.
 */
function jsonPathAt(lines: readonly string[], target: number): string {
  const path: string[] = [];
  for (let index = 0; index < target; index++) {
    const line = lines[index];
    if (line === undefined) continue;
    const indent = line.length - line.trimStart().length;
    while (path.length > 0) {
      const previous = lines[index - 1] ?? "";
      const previousIndent = previous.length - previous.trimStart().length;
      if (previousIndent < indent) break;
      if (previousIndent === indent && !/^[[{]/.test(previous.trimStart())) path.pop();
      else break;
    }
    const key = /"([^"]+)":/.exec(line.trimStart());
    if (key?.[1] !== undefined) path.push(`.${key[1]}`);
    else if (/^[\d]+,?$/.test(line.trimStart().replace(/,$/, ""))) path.push(`[${line.trim().replace(/,$/, "")}]`);
  }
  return path.join("") === "" ? "(document root)" : path.join("");
}

/**
 * Scans a corpus expected file for anything that would make it machine-specific.
 *
 * A snapshot that recorded where it was generated would not be a conformance
 * fixture; it would be a receipt. This is checked rather than trusted, because
 * the failure is invisible in review on a line that looks like data.
 */
export function environmentLeaks(text: string): string[] {
  const leaks: string[] = [];
  const absolute = /"(source|sourcePath|path|targetPath)":\s*"([A-Za-z]:[\\/]|\/|\\\\)/g;
  for (const match of text.matchAll(absolute)) {
    leaks.push(`absolute path in ${String(match[1])}: ${String(match[2])}`);
  }
  for (const field of ["timestamp", "generatedAt", "hostname", "pid", "duration", "elapsedMs"]) {
    if (text.includes(`"${field}"`)) {
      leaks.push(`non-deterministic field: ${field}`);
    }
  }
  return leaks;
}

/** Normalises a filesystem path for reporting only, never for comparison. */
export function displayPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

// ---------------------------------------------------------------------------
// The stable projection
// ---------------------------------------------------------------------------

/**
 * The subset of the snapshot the stability document actually promises.
 *
 * This exists to make the stability claim **testable rather than prose**. A
 * document that lists stable fields and a test suite that pins a projection of
 * exactly those fields are the same promise written twice, and the second
 * writing is the one that fails when somebody changes something.
 *
 * Three properties, each of which is worth having on its own:
 *
 * 1. It is **pure**. It transforms a snapshot and invents nothing — no
 *    derived counts, no renamed keys, no default fills. A projection that
 *    computed something would be a second model, and two models disagree.
 * 2. A change confined to a **provisional** field leaves it byte-identical,
 *    which is the mechanical meaning of "compatibility is not promised".
 * 3. A change to a **stable** field changes it, which is the mechanical meaning
 *    of "a consumer may rely on this".
 *
 * It is a compatibility check, not the conformance comparison. The corpus still
 * compares the whole snapshot, because a provisional field changing is
 * information a maintainer of *this* repository wants, and hiding it behind a
 * projection would make the corpus blind to exactly the drift it exists to
 * catch.
 */
export function stableProjection(snapshot: unknown): unknown {
  const document = snapshot as {
    facts?: Record<string, unknown>;
    summary?: Record<string, unknown>;
    graph?: Record<string, unknown> | null;
  };
  const graph = document.graph;
  const projection: Record<string, unknown> = {
    // Every fact's identity, epistemic shape, evidence and corroboration. The
    // VALUE of a value-shaped fact is included, because what a repository
    // declares is the promise; a domain-specific projection of that value is
    // not, and the facts whose value shape is stable carry it whole.
    facts: mapValues(document.facts ?? {}, (fact) => projectFact(fact)),
    summary: { complete: document.summary?.["complete"] },
  };
  if (graph === null || graph === undefined) {
    projection["graph"] = null;
    return projection;
  }
  projection["graph"] = {
    // The structural invariants and the provenance guarantee, and deliberately
    // not the contents: which files form the source universe, how an import
    // resolved, and which CODEOWNERS patterns are supported are all provisional,
    // and a projection that included them would promise them.
    nodes: (graph["nodes"] as unknown[]).map((node) => projectNode(node)),
    ownership: {
      status: (graph["ownership"] as Record<string, unknown>)["status"],
    },
    complete: graph["complete"],
  };
  return projection;
}

function projectFact(fact: unknown): unknown {
  const value = fact as Record<string, unknown>;
  const projected: Record<string, unknown> = {
    id: value["id"],
    kind: value["kind"],
  };
  if (value["reason"] !== undefined) projected["reason"] = value["reason"];
  if (value["contradictedBy"] !== undefined) projected["contradictedBy"] = value["contradictedBy"];
  projected["claims"] = (value["claims"] as Record<string, unknown>[] | undefined)?.map((claim) => ({
    kind: claim["kind"],
    evidence: claim["evidence"],
  }));
  projected["corroboration"] = value["corroboration"];
  if (value["value"] !== undefined) projected["value"] = value["value"];
  return projected;
}

function projectNode(node: unknown): unknown {
  const value = node as Record<string, unknown>;
  const provenance = value["provenance"] as Record<string, unknown>;
  const projected: Record<string, unknown> = {
    id: value["id"],
    kind: value["kind"],
    // The provenance guarantee: a repository-relative source and a 1-based
    // line. The column range and the pointer beside them are provisional and
    // are left out.
    provenance: {
      source: provenance?.["source"],
      line: provenance?.["line"],
    },
  };
  if (value["path"] !== undefined) projected["path"] = value["path"];
  // Only some node kinds are ownership SUBJECTS. An external dependency is
  // not a file a CODEOWNERS rule can match, so it carries no ownership state;
  // projecting a status for it would invent one.
  const ownership = value["ownership"] as Record<string, unknown> | undefined;
  if (ownership !== undefined && ownership !== null) {
    projected["ownership"] = ownership["status"];
  }
  return projected;
}

function mapValues(
  source: Record<string, unknown>,
  transform: (value: unknown) => unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort(compareCodeUnits)) {
    result[key] = transform(source[key]);
  }
  return result;
}
