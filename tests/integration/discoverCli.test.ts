/**
 * `agent-ready discover --json` against a single deliberately messy repository.
 *
 * The point of this file is one claim: that the #36 substrate survives a real
 * domain. The fixture below is built so that **one** snapshot contains every
 * outcome the model has to distinguish at once — a known fact, an unknown fact,
 * a conflict, a contest, real corroboration, an unmodelled form, and a partial
 * diagnostic — without any of them being contrived into existence. It is an
 * ordinary repository that happens to be inconsistent in six ways, which is the
 * only kind of inconsistency the model will meet in anger.
 *
 * Nothing here is a unit test. Probes, parsing, expansion, and merging are
 * covered in the `discover*` unit suites; this file is the end-to-end check that
 * they compose into a coherent and honest snapshot.
 */

import { describe, expect, it } from "vitest";
import { runDiscover } from "../../src/cli/commands/discover.js";
import type { DiscoverySnapshot, Fact, IncompleteFact } from "../../src/discover/types.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { contractClaiming, manifest } from "../unit/discoverTestDoubles.js";

/**
 * A pnpm-rooted monorepo that has drifted:
 *
 *  - the root declares pnpm and ships a pnpm lockfile (agreed, corroborated);
 *  - a second tool's lockfile is still committed (the root manager is *contested*);
 *  - the contract claims npm, disagreeing with the repository (a third voice);
 *  - a nested package pins its own manager, coherently (scoped, not flattened);
 *  - one workspace member's manifest is malformed (partial, smallest boundary);
 *  - one declared workspace path does not exist (honest absence);
 *  - a glob matches a directory that is not a package (candidate, not member);
 *  - one member declares a `packageManager` form this version does not model.
 */
function messyRepository(): InMemoryFileSystem {
  const fs = new InMemoryFileSystem("/repo");
  fs.addDirectory("/repo/.git");
  fs.addFile("/repo/AGENTS.md", "# agents\n");

  // Root: declares pnpm, and still has npm's lockfile committed.
  fs.addFile(
    "/repo/package.json",
    manifest({
      name: "monorepo",
      private: true,
      packageManager: "pnpm@10.0.0",
      workspaces: ["packages/*", "tools/withheld"],
    }),
  );
  fs.addFile("/repo/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  fs.addFile("/repo/package-lock.json", manifest({ lockfileVersion: 3 }));

  // A coherent nested package with its own manager.
  fs.addFile(
    "/repo/packages/legacy/package.json",
    manifest({ name: "legacy", version: "2.0.0", packageManager: "npm@10.9.2" }),
  );
  fs.addFile("/repo/packages/legacy/package-lock.json", manifest({ lockfileVersion: 3 }));

  // A member whose manifest is broken. Its neighbours must survive it.
  fs.addFile("/repo/packages/broken/package.json", "{ this is not json");

  // A glob match that is not a package.
  fs.addFile("/repo/packages/docs/guide.md", "# guide\n");

  // A member whose declaration uses a form this version does not model.
  fs.addFile(
    "/repo/packages/odd/package.json",
    manifest({ name: "odd", packageManager: "workspace:*" }),
  );
  fs.addFile("/repo/packages/odd/yarn.lock", "");

  // The author's contract, disagreeing with everything above.
  fs.addFile("/repo/agent-ready.yaml", contractClaiming("yarn", "1.22.22"));

  return fs;
}

interface SnapshotBody {
  readonly ok: true;
  readonly snapshotVersion: number;
  readonly root: string;
  readonly facts: Readonly<Record<string, Fact>>;
  readonly summary: DiscoverySnapshot["summary"];
  readonly diagnostics: readonly {
    readonly code: string;
    readonly severity: string;
    readonly detail?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }[];
}

async function discoverJson(root = "/repo"): Promise<{ body: SnapshotBody; stdout: string }> {
  const outcome = await runDiscover(messyRepository(), { json: true, root });
  expect(outcome.exitCode, "a messy repository must still exit successfully").toBe(0);
  return { body: JSON.parse(outcome.stdout) as SnapshotBody, stdout: outcome.stdout };
}

function fact(body: SnapshotBody, id: string): Fact {
  const found = body.facts[id];
  if (found === undefined) {
    throw new Error(`expected ${id}; saw ${Object.keys(body.facts).join(", ")}`);
  }
  return found;
}

function codes(body: SnapshotBody): string[] {
  return body.diagnostics.map((diagnostic) => diagnostic.code);
}

/** Narrows to a fact that asserts something, failing with a useful message. */
function knownFact(body: SnapshotBody, id: string): Exclude<Fact, { kind: "unknown" }> {
  const found = fact(body, id);
  if (found.kind === "unknown") {
    throw new Error(`expected ${id} to be known, got unknown (${found.reason})`);
  }
  return found;
}

/** Narrows further to a fact that has a value, failing if it is a conflict. */
function valuedFact(
  body: SnapshotBody,
  id: string,
): Exclude<Fact, { kind: "unknown" }> & {
  value: NonNullable<unknown>;
} {
  const found = knownFact(body, id);
  if (!("value" in found)) {
    throw new Error(`expected ${id} to carry a value; it is a conflict with no winner`);
  }
  return found as Exclude<Fact, { kind: "unknown" }> & { value: NonNullable<unknown> };
}

describe("one snapshot, every outcome the fact model has to distinguish", () => {
  it("produces known, unknown, contested, conflicting, and partial at once", async () => {
    const { body } = await discoverJson();

    // --- known and agreed, from genuinely independent evidence --------------
    // The root's declared manager, corroborated by a pnpm lockfile that exists
    // independently of the manifest field.
    const root = valuedFact(body, "repository.packageManager.root");
    expect(root.value).toBe("pnpm@10.0.0");
    expect(root.corroboration).toMatchObject({
      kinds: ["author-declared", "declared", "derived"],
      authorDeclared: true,
      corroborated: true,
    });

    // --- contested, not resolved --------------------------------------------
    // The value is the declaration; npm's lockfile and the contract's yarn claim
    // are published as the disagreement. A contested fact still has a value, and
    // saying so is the whole reason this outcome exists separately from a
    // conflict.
    expect("contradictedBy" in root).toBe(true);
    expect((root as IncompleteFact).contradictedBy).toEqual(["npm", "yarn"]);

    // --- conflict -----------------------------------------------------------
    // Not present here, and that is worth stating: every disagreement in this
    // repository has a declared claim to hang off, so none of them is a
    // value-less conflict. The dedicated conflict case is covered in
    // `discoverPackageManager.test.ts`; asserting its absence here keeps this
    // fixture honest about what it actually contains.
    expect(body.summary.conflicts).toBe(0);

    // --- unknown ------------------------------------------------------------
    // `tools/withheld` is declared and absent, so it is a candidate recorded as
    // absent rather than a package that does not exist.
    const packages = valuedFact(body, "repository.packages");
    const paths = (packages.value as { path: string; manifestStatus: string }[]).map(
      (entry) => entry.path,
    );
    // `packages/docs` matched the glob but holds no manifest, so it is not a
    // package. `tools/withheld` is declared and absent, so it is not a package
    // either — and both absences are visible elsewhere rather than inferred from
    // this list.
    expect(paths).toEqual([".", "packages/broken", "packages/legacy", "packages/odd"]);
    // `tools/withheld` is not there, so it is not a package — and its absence is
    // visible in the candidates rather than dropped.
    const candidates = valuedFact(body, "repository.workspace.candidates");
    const withheld = (candidates.value as { path: string; present: boolean | null }[]).find(
      (entry) => entry.path === "tools/withheld",
    );
    expect(withheld).toMatchObject({ present: false });

    // A directory a glob matched that holds no manifest: a candidate, never a
    // package. Inferring a package from a matched directory is the mistake this
    // whole separation exists to prevent, so it is checked in both directions:
    // it is absent from the packages, and present in the candidates.
    const candidates2 = valuedFact(body, "repository.workspace.candidates");
    const candidatePaths = (candidates2.value as { path: string }[]).map((entry) => entry.path);
    expect(candidatePaths).toContain("packages/docs");
    expect(paths).not.toContain("packages/docs");
    const members = valuedFact(body, "repository.workspace.members");
    const memberPaths = (members.value as { path: string; manifestStatus: string }[]).map(
      (entry) => entry.path,
    );
    expect(memberPaths).toEqual(["packages/broken", "packages/legacy", "packages/odd"]);

    // --- nested scoping, not flattening -------------------------------------
    // A member that pins npm, coherently, is a separate fact. Folding it into
    // the root's answer would manufacture a disagreement that does not exist.
    const nested = valuedFact(body, "repository.packageManager.packages/legacy");
    expect(nested.value).toBe("npm@10.9.2");
    // Uncontested within its own scope: the root manager says nothing about it.
    expect("contradictedBy" in nested).toBe(false);

    // --- partial, at the smallest possible boundary -------------------------
    // One broken manifest costs exactly one package. Every other member is
    // intact and the snapshot as a whole remains usable.
    expect(body.summary.complete).toBe(false);
    expect(body.summary.known).toBeGreaterThan(0);
    const broken = paths.includes("packages/broken");
    expect(broken).toBe(true);
    const partial = body.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "DISCOVERY_PARTIAL" &&
        diagnostic.metadata?.["path"] === "packages/broken/package.json",
    );
    expect(partial, "the failing path must be named").toBeDefined();

    // --- unmodelled shape, named rather than guessed -------------------------
    expect(codes(body)).toContain("DISCOVERY_FACT_UNSUPPORTED");
    const unsupported = body.diagnostics.find(
      (diagnostic) => diagnostic.code === "DISCOVERY_FACT_UNSUPPORTED",
    );
    expect(unsupported?.detail).toContain("workspace:*");
    // And the member's own lockfile evidence still stands, so an unmodelled
    // declaration in one package cannot erase what another source observed. The
    // value is the artifact path relative to the repository, which is what makes
    // it a claim about *that* package rather than a repository-wide one.
    const odd = valuedFact(body, "repository.packageManager.packages/odd");
    expect(odd.value).toBe("packages/odd/yarn.lock");
  });

  it("describes the operation without judging the repository", async () => {
    const { body } = await discoverJson();
    // No score, no percentage, no ranking, no advice. A diagnostic may say what
    // a reader should look at; it may not grade the repository.
    const serialised = JSON.stringify(body);
    for (const forbidden of [
      "score",
      "Score",
      "readiness",
      "Readiness",
      "confidence",
      "Confidence",
      "health",
      "recommend",
    ]) {
      expect(serialised, `snapshot contains "${forbidden}"`).not.toContain(forbidden);
    }
    for (const diagnostic of body.diagnostics) {
      expect(["error", "warning"]).toContain(diagnostic.severity);
    }
  });

  it("is byte-identical across runs, and independent of where the repository lives", async () => {
    const first = await discoverJson();
    const second = await discoverJson();
    expect(second.stdout).toBe(first.stdout);

    // The same content under a different absolute root must produce the same
    // bytes. Not "the same facts" — the same bytes, because a path that leaked
    // into a detail string or a sort key would survive the weaker check.
    const relocatedRoot = "/home/someone/checkout/agent-ready";
    const relocated = new InMemoryFileSystem(relocatedRoot);
    for (const [absolute, content] of entriesOf(messyRepository())) {
      relocated.addFile(absolute.replace("/repo", relocatedRoot), content);
    }
    // The `.git` boundary has to come along, or the two repositories resolve to
    // different roots for a reason that has nothing to do with the bytes.
    relocated.addDirectory(`${relocatedRoot}/.git`);
    const elsewhere = await runDiscover(relocated, { json: true, root: relocatedRoot });
    expect(elsewhere.exitCode).toBe(0);
    expect(elsewhere.stdout).toBe(first.stdout);
  });

  it("works with no contract at all, and differs only by the author's claim", async () => {
    const withoutContract = new InMemoryFileSystem("/repo");
    for (const [absolute, content] of entriesOf(messyRepository())) {
      if (absolute === "/repo/agent-ready.yaml") continue;
      withoutContract.addFile(absolute, content);
    }
    withoutContract.addDirectory("/repo/.git");

    const withContract = await discoverJson();
    const without = await runDiscover(withoutContract, { json: true, root: "/repo" });
    expect(without.exitCode).toBe(0);
    const withoutBody = JSON.parse(without.stdout) as SnapshotBody;

    // Every fact the contract does not speak to is byte-identical. ADR-0044's
    // third rule: the contract changes which facts become available, never which
    // become true.
    for (const id of [
      "repository.packages",
      "repository.workspace.declarations",
      "repository.workspace.candidates",
      "repository.workspace.members",
      "repository.workspace.root",
    ]) {
      expect(JSON.stringify(withoutBody.facts[id]), `${id} changed with the contract`).toBe(
        JSON.stringify(withContract.body.facts[id]),
      );
    }

    // The only difference is the author-declared contribution, and the fact it
    // lands on says so.
    const rootWithout = knownFact(withoutBody, "repository.packageManager.root");
    const rootWith = knownFact(withContract.body, "repository.packageManager.root");
    expect(rootWithout.corroboration.authorDeclared).toBe(false);
    expect(rootWith.corroboration.authorDeclared).toBe(true);
  });

  it("renders structured values in the human output without inventing certainty", async () => {
    const outcome = await runDiscover(messyRepository(), { json: false, root: "/repo" });
    expect(outcome.exitCode).toBe(0);

    // The single most important property of the human renderer: no value is
    // ever printed through `String()`, so nothing can come out as
    // `[object Object]`.
    expect(outcome.stdout).not.toContain("[object Object]");
    expect(outcome.stdout).not.toContain("[object");

    // A contested manager is rendered as contested, with the disagreement named
    // — never as a bare `pnpm`, which is what a naive renderer would produce
    // from the fact's `value` and would be a false statement.
    expect(outcome.stdout).toContain("Manager (root)");
    expect(outcome.stdout).toMatch(/incomplete \(pnpm; contradicted by npm, yarn\)/);
    // The nested package is rendered as its own row, not folded in.
    expect(outcome.stdout).toContain("Manager (packages/legacy)");

    // A collection fact is summarised, not dumped.
    expect(outcome.stdout).toMatch(/Count\s+4, 3 named, 1 unreadable/);
    expect(outcome.stdout).toMatch(/Members\s+3 \(1 unreadable\)/);
    // A declared-but-absent path is visible in the summary rather than dropped.
    expect(outcome.stdout).toMatch(/Matched\s+4 present, 1 declared but absent/);
    // A nested package's manager renders as a name, not as a raw quoted path.
    expect(outcome.stdout).toMatch(/Manager \(packages\/odd\)\s+yarn/);
  });
});

/** Re-registers a repository's files under a new root. */
function entriesOf(fs: InMemoryFileSystem): [string, string][] {
  const collected: [string, string][] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.listDirectorySync(directory)) {
      const absolute = directory === "/" ? `/${entry.name}` : `${directory}/${entry.name}`;
      if (entry.isDirectory) {
        walk(absolute);
        continue;
      }
      collected.push([absolute, fs.readTextSync(absolute)]);
    }
  };
  walk("/repo");
  return collected;
}
