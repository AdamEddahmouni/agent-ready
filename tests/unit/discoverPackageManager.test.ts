/**
 * Package-manager discovery, tested against the probes and the merge rather
 * than through the CLI.
 *
 * A domain bug should be diagnosable without running a command and reading
 * formatted output, so every case here goes through `discoverRepository` and
 * inspects the snapshot's structure. The one thing tested through the command
 * surface is rendering, and that lives in `discoverCommand.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { discoverRepository } from "../../src/discover/discover.js";
import { isIncompleteFact } from "../../src/discover/types.js";
import type { DiscoverySnapshot, Fact, IncompleteFact } from "../../src/discover/types.js";
import {
  isSupportedDeclarationForm,
  managerForLockfile,
  managerFromDeclaration,
} from "../../src/discover/packages/packageManager.js";
import { contractClaiming, FaultyFileSystem, manifest, repoWith } from "./discoverTestDoubles.js";

const ROOT_MANAGER = "repository.packageManager.root";

async function snapshotOf(
  files: Parameters<typeof repoWith>[0],
  root = "/repo",
): Promise<DiscoverySnapshot> {
  const result = await discoverRepository(repoWith(files), { startDir: root });
  if (!result.ok) {
    throw new Error(`expected discovery to succeed: ${result.diagnostics[0]?.summary ?? ""}`);
  }
  return result.snapshot;
}

function factAt(snapshot: DiscoverySnapshot, id: string): Fact {
  const found = snapshot.facts[id];
  if (found === undefined) {
    throw new Error(`expected a fact at ${id}, saw ${Object.keys(snapshot.facts).join(", ")}`);
  }
  return found;
}

function known(fact: Fact): Exclude<Fact, { kind: "unknown" }> {
  if (fact.kind === "unknown") {
    throw new Error(`expected a known fact, got unknown (${fact.reason})`);
  }
  return fact;
}

function codes(snapshot: DiscoverySnapshot): string[] {
  return snapshot.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("the package-manager name rule is one documented projection", () => {
  it("takes the text before the first @, and nothing else", () => {
    expect(managerFromDeclaration("pnpm@10.0.0")).toBe("pnpm");
    expect(managerFromDeclaration("yarn@1.22.22")).toBe("yarn");
    expect(managerFromDeclaration("npm@10.9.2")).toBe("npm");
    // A scoped name is not a package-manager family: no package manager is
    // scoped, so `@scope/pkg@1.0.0` is npm package-name syntax and yields no
    // name at all. Declining it is what keeps the projection from minting a
    // manager that cannot exist and cannot match a lockfile.
    expect(managerFromDeclaration("@scope/pkg@1.0.0")).toBeUndefined();
    expect(isSupportedDeclarationForm("@scope/pkg@1.0.0")).toBe(false);
    // A trailing @ separator with no version is not a declaration either.
    expect(managerFromDeclaration("pnpm@")).toBeUndefined();
    expect(managerFromDeclaration("@1.0.0")).toBeUndefined();
  });

  it("declines every form it cannot parse rather than splitting on a guess", () => {
    // Each of these is a real thing repositories contain. Splitting any of them
    // at a separator that may not be there would produce a plausible manager
    // name the repository never wrote.
    for (const raw of [
      "pnpm",
      "",
      "   ",
      "pnpm @ 1",
      "@scope/pkg@1.0.0",
      "workspace:*",
      42,
      null,
      true,
      { name: "pnpm" },
      ["pnpm"],
    ]) {
      expect(managerFromDeclaration(raw)).toBeUndefined();
      expect(isSupportedDeclarationForm(raw)).toBe(false);
    }
    expect(isSupportedDeclarationForm("pnpm@10.0.0")).toBe(true);
  });

  it("maps lockfile names through a fixed table, not a resemblance heuristic", () => {
    expect(managerForLockfile("package-lock.json")).toBe("npm");
    expect(managerForLockfile("npm-shrinkwrap.json")).toBe("npm");
    expect(managerForLockfile("pnpm-lock.yaml")).toBe("pnpm");
    expect(managerForLockfile("yarn.lock")).toBe("yarn");
    // A file this version does not know about contributes nothing. Guessing
    // "probably npm" from a lockfile-shaped name is the inference the whole
    // table exists to avoid.
    expect(managerForLockfile("bun.lockb")).toBeUndefined();
    expect(managerForLockfile("deno.lock")).toBeUndefined();
    expect(managerForLockfile("package.json")).toBeUndefined();
  });
});

describe("case A — a clean npm package", () => {
  it("reports npm from a single independent artifact, with no overclaim", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "solo", version: "1.0.0" }),
      "package-lock.json": manifest({ lockfileVersion: 3 }),
    });
    const fact = known(factAt(snapshot, ROOT_MANAGER));
    expect(fact).toMatchObject({ kind: "derived", value: "package-lock.json" });
    // One claim, one source: a single lockfile does not corroborate itself.
    expect(fact.corroboration).toMatchObject({ corroborated: false, authorDeclared: false });
    expect(codes(snapshot)).not.toContain("DISCOVERY_FACT_CONFLICT");
  });
});

describe("case B — a clean pnpm package", () => {
  it("corroborates a declaration against a lockfile from independent evidence", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "solo", packageManager: "pnpm@10.0.0" }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });
    const fact = known(factAt(snapshot, ROOT_MANAGER));
    // Two genuinely independent sources: a field in the manifest and a separate
    // artifact on disk. This is the one case where corroboration is real.
    expect(fact).toMatchObject({ kind: "declared", value: "pnpm@10.0.0" });
    expect(fact.corroboration).toMatchObject({
      corroborated: true,
      kinds: ["declared", "derived"],
    });
    // The declaration is retained verbatim, so the pinned version is not lost
    // in favour of a bare family name.
    const declared = fact.claims.find((claim) => claim.kind === "declared");
    expect(declared?.value).toBe("pnpm@10.0.0");
    expect(declared?.evidence[0]).toMatchObject({
      source: "package.json",
      pointer: "/packageManager",
    });
  });
});

describe("case C — a declaration contradicted by another tool's artifact", () => {
  it("keeps the declaration and publishes the artifact that contradicts it", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "solo", packageManager: "pnpm@10.0.0" }),
      "package-lock.json": manifest({ lockfileVersion: 3 }),
    });
    const fact = factAt(snapshot, ROOT_MANAGER);
    expect(isIncompleteFact(fact)).toBe(true);
    const incomplete = fact as IncompleteFact;
    // The declaration is carried forward, and the contradicting artifact is
    // published. Neither is discarded and neither is a winner.
    expect(incomplete.value).toBe("pnpm@10.0.0");
    expect(incomplete.contradictedBy).toEqual(["npm"]);
    expect(incomplete.claims).toHaveLength(2);
    expect(codes(snapshot)).toContain("DISCOVERY_FACT_INCOMPLETE");
    // A contest is not a contradiction: `summary.conflicts` counts the
    // no-value case, and this fact does have a value.
    expect(snapshot.summary.conflicts).toBe(0);
    expect(snapshot.summary.known).toBeGreaterThan(0);
  });

  it("never resolves the contest by priority, recency, or majority", async () => {
    // The same repository with the two files swapped in creation order, and with
    // a third artifact added, must reach the same conclusion. If any ordering
    // or count-based rule existed, these would differ.
    const one = await snapshotOf({
      "package.json": manifest({ packageManager: "pnpm@10.0.0" }),
      "package-lock.json": manifest({ lockfileVersion: 3 }),
    });
    const two = await snapshotOf({
      "package-lock.json": manifest({ lockfileVersion: 3 }),
      "package.json": manifest({ packageManager: "pnpm@10.0.0" }),
    });
    expect(JSON.stringify(factAt(one, ROOT_MANAGER))).toBe(
      JSON.stringify(factAt(two, ROOT_MANAGER)),
    );

    const three = await snapshotOf({
      "package.json": manifest({ packageManager: "pnpm@10.0.0" }),
      "package-lock.json": manifest({ lockfileVersion: 3 }),
      "npm-shrinkwrap.json": manifest({ lockfileVersion: 3 }),
    });
    const widened = factAt(three, ROOT_MANAGER);
    expect(isIncompleteFact(widened)).toBe(true);
    // Two npm artifacts, one disagreement. Sorted and deduplicated, because two
    // files from the same tool are one disagreement stated twice.
    expect((widened as IncompleteFact).contradictedBy).toEqual(["npm"]);
  });
});

describe("case D — three lockfiles and no declaration", () => {
  it("is a conflict with no value, never the first manager in a table", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "messy" }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "yarn.lock": "",
      "package-lock.json": manifest({ lockfileVersion: 3 }),
    });
    const fact = factAt(snapshot, ROOT_MANAGER);
    // No value at all. Not `pnpm` because pnpm is first in the signal table,
    // not `npm` because npm is alphabetically first, not `yarn` because it is
    // the most recently written lockfile format.
    expect("value" in fact).toBe(false);
    expect(known(fact).claims).toHaveLength(3);
    expect(snapshot.summary.conflicts).toBe(1);
    expect(codes(snapshot)).toContain("DISCOVERY_FACT_CONFLICT");
    // Every artifact is retained with its own evidence, so a consumer can see
    // all three without re-reading the repository.
    const sources = known(fact).claims.map((claim) => claim.evidence[0]?.source);
    expect(sources).toEqual(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
  });

  it("orders the retained claims deterministically, not by discovery order", async () => {
    const forwards = await snapshotOf({
      "package.json": manifest({ name: "messy" }),
      "package-lock.json": manifest({ lockfileVersion: 3 }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "yarn.lock": "",
    });
    const backwards = await snapshotOf({
      "yarn.lock": "",
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "package-lock.json": manifest({ lockfileVersion: 3 }),
      "package.json": manifest({ name: "messy" }),
    });
    expect(JSON.stringify(factAt(forwards, ROOT_MANAGER))).toBe(
      JSON.stringify(factAt(backwards, ROOT_MANAGER)),
    );
  });
});

describe("case E — an author claim that conflicts with repository evidence", () => {
  it("is retained as author-declared and never overwrites what the repository shows", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "solo", packageManager: "pnpm@10.0.0" }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "agent-ready.yaml": contractClaiming("npm", "10.9.2"),
    });
    const fact = factAt(snapshot, ROOT_MANAGER);
    expect(isIncompleteFact(fact)).toBe(true);
    const incomplete = fact as IncompleteFact;
    // The repository's two claims stand; the author's disagreement is added
    // beside them rather than replacing either.
    expect(incomplete.value).toBe("pnpm@10.0.0");
    expect(incomplete.contradictedBy).toEqual(["npm"]);
    expect(incomplete.claims.map((claim) => claim.kind)).toEqual([
      "author-declared",
      "declared",
      "derived",
    ]);
    const authorClaim = incomplete.claims.find((claim) => claim.kind === "author-declared");
    expect(authorClaim?.evidence[0]?.source).toBe("agent-ready.yaml");
    // The author claim never counts as independent corroboration of a
    // repository-derived value, so `corroborated` still reflects the two
    // repository sources.
    expect(incomplete.corroboration).toMatchObject({ authorDeclared: true, corroborated: true });
  });

  it("keeps an uncorroborated author claim visible rather than accepting or discarding it", async () => {
    // The contract claims npm; the repository says nothing at all. The claim is
    // the only evidence, and the snapshot presents it as exactly that.
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "solo" }),
      "agent-ready.yaml": contractClaiming("npm", "10.9.2"),
    });
    const fact = known(factAt(snapshot, ROOT_MANAGER));
    expect(fact).toMatchObject({ kind: "author-declared", value: "npm@10.9.2" });
    expect(fact.corroboration).toMatchObject({
      authorDeclared: true,
      corroborated: false,
      kinds: ["author-declared"],
    });
  });

  it("leaves repository-derived facts byte-identical whether or not a contract exists", async () => {
    const files = {
      "package.json": manifest({ name: "solo", packageManager: "pnpm@10.0.0" }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    };
    const without = await snapshotOf(files);
    const with_ = await snapshotOf({
      ...files,
      "agent-ready.yaml": contractClaiming("npm", "10.9.2"),
    });
    for (const id of [
      "repository.packages",
      "repository.workspace.declarations",
      "repository.workspace.members",
    ] as const) {
      expect(JSON.stringify(without.facts[id])).toBe(JSON.stringify(with_.facts[id]));
    }
  });
});

describe("case F — no package-manager signals at all", () => {
  it("is unknown with no-evidence, never npm by default", async () => {
    const snapshot = await snapshotOf({ "package.json": manifest({ name: "silent" }) });
    const fact = factAt(snapshot, ROOT_MANAGER);
    expect(fact).toMatchObject({ kind: "unknown", reason: "no-evidence" });
    // Node's historical package manager is a fact about Node, not about this
    // repository. Inferring it from the absence of a declaration is exactly the
    // fabricated knowledge the boundary exists to prevent.
    expect(JSON.stringify(snapshot)).not.toContain('"value": "npm"');
  });

  it("reports an unstat-able lockfile as its own condition, not as absence", async () => {
    // The failure mode this guards is silence. If a lockfile cannot be inspected
    // and the probe simply reported "nothing found", the snapshot would say the
    // repository declares no manager and has no lockfile — a complete and
    // confident answer derived from an I/O error. The fact has to be `unknown`
    // for a reason that names the obstruction, the snapshot has to admit it is
    // not complete, and the diagnostic has to be the one whose documentation
    // explains this specific condition.
    const fs = new FaultyFileSystem("/repo");
    fs.addFile("/repo/package.json", manifest({ name: "locked" }));
    fs.addFile("/repo/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    fs.addDirectory("/repo/.git");
    fs.failOn("/repo/pnpm-lock.yaml");

    const result = await discoverRepository(fs, { startDir: "/repo" });
    if (!result.ok) throw new Error("expected discovery to succeed");

    const fact = factAt(result.snapshot, ROOT_MANAGER);
    // Ignorance, and labelled as ignorance: never `no-evidence`, which would
    // claim the inspection completed and found nothing.
    expect(fact).toMatchObject({ kind: "unknown", reason: "probe-failed" });
    // And the specific code, not the generic one, so `agent-ready explain`
    // lands on the page that answers it.
    const diagnostic = result.snapshot.diagnostics.find(
      (candidate) => candidate.code === "DISCOVERY_LOCKFILE_UNREADABLE",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.sourcePath).toBe("pnpm-lock.yaml");
    expect(result.snapshot.summary.complete).toBe(false);
  });

  it("keeps a declared manager when its lockfile cannot be inspected", async () => {
    // The narrower case, and the one a real repository hits: the manifest is
    // readable and says pnpm, the lockfile is not stat-able. The declaration is
    // still a true statement and is still reported — with the disagreement
    // absent because there was none, and with the fact marked uncorroborated
    // because nothing independent could be read to support it.
    const fs = new FaultyFileSystem("/repo");
    fs.addFile("/repo/package.json", manifest({ name: "locked", packageManager: "pnpm@10.0.0" }));
    fs.addFile("/repo/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    fs.addDirectory("/repo/.git");
    fs.failOn("/repo/pnpm-lock.yaml");

    const result = await discoverRepository(fs, { startDir: "/repo" });
    if (!result.ok) throw new Error("expected discovery to succeed");
    const fact = known(factAt(result.snapshot, ROOT_MANAGER));
    expect(fact).toMatchObject({ kind: "declared", value: "pnpm@10.0.0" });
    // One claim, so no corroboration is claimed: the one source that would have
    // supported it could not be read.
    expect(isIncompleteFact(fact)).toBe(false);
    if (isIncompleteFact(fact)) return;
    expect("corroboration" in fact ? fact.corroboration.corroborated : undefined).toBe(false);
    expect(codes(result.snapshot)).toContain("DISCOVERY_LOCKFILE_UNREADABLE");
    expect(result.snapshot.summary.complete).toBe(false);
  });

  it("reports the paths it inspected, so the absence is evidenced", async () => {
    const snapshot = await snapshotOf({ "package.json": manifest({ name: "silent" }) });
    const fact = factAt(snapshot, ROOT_MANAGER);
    if (fact.kind !== "unknown") throw new Error("expected unknown");
    // "We looked here and found nothing" must stay distinguishable from
    // "nobody checked", which is what the evidence set is for.
    const sources = fact.evidence.map((item) => item.source);
    expect(sources).toContain("package.json");
    expect(sources).toContain("pnpm-lock.yaml");
    expect(sources).toContain("yarn.lock");
  });

  it("reports a repository with no manifest at all as unknown, not as an error", async () => {
    const snapshot = await snapshotOf({ "README.md": "# hello\n" });
    expect(factAt(snapshot, ROOT_MANAGER)).toMatchObject({
      kind: "unknown",
      reason: "no-evidence",
    });
    expect(snapshot.summary.complete).toBe(true);
  });
});

describe("an unmodelled declaration form", () => {
  it("makes no name claim, still reports the lockfile evidence, and says why", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "odd", packageManager: "workspace:*" }),
      "yarn.lock": "",
    });
    const fact = known(factAt(snapshot, ROOT_MANAGER));
    // The lockfile claim stands on its own; the unmodelled declaration
    // contributes nothing rather than contributing a guess.
    expect(fact.claims.every((claim) => claim.kind === "derived")).toBe(true);
    expect(fact).toMatchObject({ value: "yarn.lock" });
    expect(codes(snapshot)).toContain("DISCOVERY_FACT_UNSUPPORTED");
    const diagnostic = snapshot.diagnostics.find(
      (entry) => entry.code === "DISCOVERY_FACT_UNSUPPORTED",
    );
    // The raw value is preserved in the diagnostic, which is where "I saw
    // something I do not model" belongs.
    expect(diagnostic?.detail).toContain("workspace:*");
  });

  it("is unknown with not-probed when the unmodelled form is the only evidence", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "odd", packageManager: "pnpm" }),
    });
    expect(factAt(snapshot, ROOT_MANAGER)).toMatchObject({
      kind: "unknown",
      reason: "not-probed",
    });
    expect(codes(snapshot)).toContain("DISCOVERY_FACT_UNSUPPORTED");
  });

  it("is still reported when a sibling package declares a supported form", async () => {
    // Regression. The unmodelled field used to be collected by the declaration
    // probe, which only raised a diagnostic when *no* claim came out of the whole
    // run. One member declaring pnpm therefore silenced the unmodelled field in
    // its sibling — a coverage gap reported as coverage. The observation now
    // belongs to the layout, which reads every manifest, so it cannot be lost.
    const snapshot = await snapshotOf({
      "package.json": manifest({
        name: "root",
        packageManager: "pnpm@10.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/odd/package.json": manifest({ name: "odd", packageManager: "workspace:*" }),
    });
    expect(codes(snapshot)).toContain("DISCOVERY_FACT_UNSUPPORTED");
    const diagnostic = snapshot.diagnostics.find(
      (entry) => entry.code === "DISCOVERY_FACT_UNSUPPORTED",
    );
    // The diagnostic names the package it is about, not just the repository.
    expect(diagnostic?.metadata).toMatchObject({
      path: "packages/odd/package.json",
      raw: "workspace:*",
    });
    // And the root's own declaration is unaffected.
    expect(known(factAt(snapshot, ROOT_MANAGER))).toMatchObject({ value: "pnpm@10.0.0" });
    // The unmodelled member's identity is reported with no claim of its own.
    expect(factAt(snapshot, "repository.packageManager.packages/odd")).toMatchObject({
      kind: "unknown",
      reason: "not-probed",
    });
  });

  it("reports each unmodelled declaration separately, in path order", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({
        name: "root",
        packageManager: "pnpm@10.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/z/package.json": manifest({ name: "z", packageManager: "workspace:^" }),
      "packages/a/package.json": manifest({ name: "a", packageManager: 42 }),
    });
    const paths = snapshot.diagnostics
      .filter((entry) => entry.code === "DISCOVERY_FACT_UNSUPPORTED")
      .map((entry) => entry.metadata?.["path"]);
    // Sorted, so the diagnostic order does not depend on which manifest was read
    // first.
    expect(paths).toEqual(["packages/a/package.json", "packages/z/package.json"]);
  });
});

describe("case N — a nested package declaring a different manager", () => {
  it("keeps two scoped facts rather than flattening them into one answer", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({
        name: "root",
        packageManager: "pnpm@10.0.0",
        workspaces: ["packages/*"],
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/legacy/package.json": manifest({
        name: "legacy",
        packageManager: "npm@10.9.2",
      }),
      "packages/legacy/package-lock.json": manifest({ lockfileVersion: 3 }),
    });

    const root = known(factAt(snapshot, "repository.packageManager.root"));
    const nested = known(factAt(snapshot, "repository.packageManager.packages/legacy"));
    // The root says pnpm and is uncontested within its own scope.
    expect(root).toMatchObject({ value: "pnpm@10.0.0" });
    expect(isIncompleteFact(root)).toBe(false);
    // The member says npm, and its own lockfile agrees: a coherent, independent
    // answer for a different identity.
    expect(nested).toMatchObject({ kind: "declared", value: "npm@10.9.2" });
    expect(isIncompleteFact(nested)).toBe(false);
    expect(nested.corroboration.corroborated).toBe(true);

    // The nested lockfile was attributed to the member, not to the root. Had it
    // been folded upward, the root would read as contested by npm — a false
    // disagreement manufactured by flattening.
    expect(root.contradictedBy).toBeUndefined();
    // And the two facts are genuinely separate entries in the snapshot.
    expect(
      Object.keys(snapshot.facts).filter((id) => id.startsWith("repository.packageManager.")),
    ).toEqual(["repository.packageManager.packages/legacy", "repository.packageManager.root"]);
  });

  it("reports a nested disagreement within the nested scope only", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", workspaces: ["packages/*"] }),
      "packages/legacy/package.json": manifest({
        name: "legacy",
        packageManager: "npm@10.9.2",
      }),
      "packages/legacy/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });
    // The root declares no manager and has no lockfile, so it is honestly
    // unknown. It is *not* made into a disagreement by what the member does.
    expect(factAt(snapshot, "repository.packageManager.root")).toMatchObject({
      kind: "unknown",
      reason: "no-evidence",
    });
    const nested = factAt(snapshot, "repository.packageManager.packages/legacy");
    expect(isIncompleteFact(nested)).toBe(true);
    expect((nested as IncompleteFact).contradictedBy).toEqual(["pnpm"]);
  });
});
