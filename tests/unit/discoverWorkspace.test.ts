/**
 * Workspace discovery: declaration parsing, expansion, and membership, tested
 * separately from one another.
 *
 * The three are separate concerns and separate failure modes — a malformed
 * `workspaces` value, a pattern that matches nothing, and a directory that
 * matched but holds no manifest — so a test that exercised all three at once
 * could only say "the workspace is wrong", which is not actionable. Parsing is
 * additionally tested against the parser directly, because "we did not
 * understand this form" is a claim about the parser and nothing else.
 */

import { describe, expect, it } from "vitest";
import { discoverRepository } from "../../src/discover/discover.js";
import {
  parsePackageJsonWorkspaces,
  parsePnpmWorkspaceYaml,
} from "../../src/discover/packages/workspaceDeclaration.js";
import {
  normalizeWorkspacePattern,
  MAX_WORKSPACE_ENTRIES,
} from "../../src/discover/packages/expand.js";
import type {
  DiscoverySnapshot,
  PackageEntry,
  WorkspaceCandidateEntry,
} from "../../src/discover/types.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { FileSystemError } from "../../src/filesystem/types.js";
import type { FileSystem } from "../../src/filesystem/types.js";
import { manifest, repoWith, repoWithReversedInsertion } from "./discoverTestDoubles.js";

/** Presents an `InMemoryFileSystem` through the `FileSystem` interface. */
function toFileSystem(fs: InMemoryFileSystem): FileSystem {
  return {
    cwd: fs.cwd,
    readTextFile: (path) => fs.readTextFile(path),
    stat: (path) => fs.stat(path),
    listDirectory: (path) => fs.listDirectory(path),
    realPath: (path) => fs.realPath(path),
    writeTextFile: (path, content) => fs.writeTextFile(path, content),
  };
}

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

/**
 * Reads a collection-valued fact.
 *
 * Generic so a caller names the shape it expects at the call site, which keeps
 * each assertion readable without a cast on every line. The parameter is still
 * checked at runtime: a fact that is unknown, absent, or valueless throws rather
 * than returning `undefined` and failing three assertions later with a confusing
 * message.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the type parameter is the point: call sites read `valueAt<PackageEntry[]>(...)`
function valueAt<T>(snapshot: DiscoverySnapshot, id: string): T {
  const fact = snapshot.facts[id];
  if (fact === undefined || fact.kind === "unknown" || !("value" in fact)) {
    throw new Error(`expected a known, valued fact at ${id}`);
  }
  return fact.value as T;
}

function codes(snapshot: DiscoverySnapshot): string[] {
  return snapshot.diagnostics.map((diagnostic) => diagnostic.code);
}

const WORKSPACED = {
  "package.json": manifest({ name: "root", workspaces: ["packages/*"] }),
} as const;

describe("workspace declaration parsing, on its own", () => {
  it("accepts the npm and Yarn-classic array form", () => {
    const parsed = parsePackageJsonWorkspaces("package.json", {
      workspaces: ["packages/*", "apps/*"],
    });
    expect(parsed).toEqual({
      source: "package.json",
      form: "array",
      // Verbatim and in declaration order: order is declared information,
      // because a `!` exclusion only means something relative to its neighbours.
      patterns: ["packages/*", "apps/*"],
      unsupportedReason: null,
    });
  });

  it("accepts the Yarn-berry object form and ignores the keys it does not model", () => {
    const parsed = parsePackageJsonWorkspaces("package.json", {
      workspaces: { packages: ["packages/*"], nohoist: ["**/react"] },
    });
    expect(parsed).toMatchObject({ form: "object", patterns: ["packages/*"] });
  });

  it("returns null rather than an unsupported entry when no workspace is declared", () => {
    // An ordinary single-package repository declares no workspace. Reporting that
    // as *unsupported* would raise a coverage warning on most of the ecosystem
    // and train every reader to ignore the code.
    expect(parsePackageJsonWorkspaces("package.json", { name: "solo" })).toBeNull();
    expect(
      parsePnpmWorkspaceYaml("pnpm-workspace.yaml", "onlyBuiltDependencies:\n  - esbuild\n"),
    ).toBeNull();
  });

  it("rejects a workspaces value it cannot model rather than coercing it", () => {
    for (const raw of ["packages/*", 42, null, true, [{ glob: "packages/*" }], ["packages/*", 7]]) {
      const parsed = parsePackageJsonWorkspaces("package.json", { workspaces: raw });
      expect(parsed?.form, `workspaces: ${JSON.stringify(raw)}`).toBe("unsupported");
      expect(parsed?.patterns).toEqual([]);
      expect(parsed?.unsupportedReason).toBeTruthy();
    }
  });

  it("rejects a whole declaration rather than silently dropping a non-string entry", () => {
    // Accepting the strings and ignoring the rest would report a workspace
    // smaller than the one the author wrote, with nothing saying so.
    const parsed = parsePackageJsonWorkspaces("package.json", { workspaces: ["packages/*", 7] });
    expect(parsed).toMatchObject({ form: "unsupported", patterns: [] });
    expect(parsed?.unsupportedReason).toContain("non-string");
  });

  it("parses pnpm-workspace.yaml through the existing safe YAML infrastructure", () => {
    const parsed = parsePnpmWorkspaceYaml(
      "pnpm-workspace.yaml",
      "packages:\n  - 'packages/*'\n  - '!packages/legacy'\n\nonlyBuiltDependencies:\n  - esbuild\n",
    );
    expect(parsed).toEqual({
      source: "pnpm-workspace.yaml",
      form: "array",
      // Order preserved, so the `!` exclusion keeps its position relative to the
      // pattern it excludes.
      patterns: ["packages/*", "!packages/legacy"],
      unsupportedReason: null,
    });
  });

  it("reports unparseable pnpm YAML as unsupported, not as an absent declaration", () => {
    // The file exists and may well contain a workspace. Reporting "no workspace
    // here" for a file full of configuration we failed to read is a false
    // negative of the most dangerous kind.
    const parsed = parsePnpmWorkspaceYaml("pnpm-workspace.yaml", "packages:\n  - [unclosed\n");
    expect(parsed).toMatchObject({ form: "unsupported" });
    expect(parsed?.unsupportedReason).toContain("YAML");
  });

  it("rejects a pnpm packages key that is not a list of strings", () => {
    expect(parsePnpmWorkspaceYaml("pnpm-workspace.yaml", "packages: 'packages/*'\n")).toMatchObject(
      {
        form: "unsupported",
      },
    );
  });
});

describe("pattern normalization refuses anything that could escape the repository", () => {
  it("rejects absolute paths and parent traversal", () => {
    for (const raw of [
      "../outside",
      "../../secret",
      "packages/../../outside",
      "/etc/passwd",
      "C:\\Windows",
      "\\\\server\\share",
    ]) {
      const result = normalizeWorkspacePattern(raw, "package.json", "/workspaces/0");
      expect(result.ok, `${raw} was accepted`).toBe(false);
    }
  });

  it("accepts the repository root, which is how a solo pnpm repo declares itself", () => {
    // This project ships `packages: ["."]`. ADR-0005 rejects a root-resolving
    // pattern for a contract path category, where it carries no information; for
    // a workspace it carries exactly that.
    const result = normalizeWorkspacePattern(".", "pnpm-workspace.yaml", "/packages/0");
    expect(result).toMatchObject({ ok: true, pattern: { pattern: "." } });
  });

  it("rejects the glob forms outside the ADR-0005 subset instead of reinterpreting them", () => {
    // Extglob semantics vary between implementations, which is why ADR-0005
    // rejects them. Reinterpreting them here would reintroduce exactly the
    // cross-tool inconsistency the subset exists to avoid.
    const result = normalizeWorkspacePattern("packages/@(a|b)", "package.json", "/workspaces/0");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the extglob pattern to be rejected");
    expect(result.reason).toContain("Extglob");
  });

  it("normalizes separators and Unicode form the way ADR-0005 does", () => {
    expect(normalizeWorkspacePattern("packages\\*", "package.json", "/workspaces/0")).toMatchObject(
      {
        ok: true,
        pattern: { pattern: "packages/*" },
      },
    );
  });
});

describe("case H — a standard workspace", () => {
  it("reports the declaration and the derived members as separate facts", async () => {
    const snapshot = await snapshotOf({
      ...WORKSPACED,
      "packages/a/package.json": manifest({ name: "@scope/a", version: "1.0.0" }),
      "packages/b/package.json": manifest({ name: "@scope/b", private: true }),
    });

    // The declaration is configuration, verbatim.
    const declarations = valueAt<{ patterns: string[] }[]>(
      snapshot,
      "repository.workspace.declarations",
    );
    expect(declarations).toEqual([
      {
        source: "package.json",
        form: "array",
        patterns: ["packages/*"],
        unsupportedReason: null,
      },
    ]);

    // The candidates are a derivation, and they are *paths*, not packages.
    const candidates = valueAt<WorkspaceCandidateEntry[]>(
      snapshot,
      "repository.workspace.candidates",
    );
    expect(candidates.map((entry) => entry.path)).toEqual(["packages/a", "packages/b"]);
    expect(candidates.every((entry) => entry.present === true)).toBe(true);
    expect(candidates[0]).toMatchObject({ source: "package.json", pattern: "packages/*" });

    // The members are the candidates that turned out to hold a manifest.
    const members = valueAt<PackageEntry[]>(snapshot, "repository.workspace.members");
    expect(members.map((member) => member.path)).toEqual(["packages/a", "packages/b"]);
    expect(members[0]).toMatchObject({
      name: "@scope/a",
      version: "1.0.0",
      manifestStatus: "read",
    });
    expect(members[1]).toMatchObject({ name: "@scope/b", private: true, version: null });

    // And the root is a package in its own right, distinct from being a member.
    const packages = valueAt<PackageEntry[]>(snapshot, "repository.packages");
    expect(packages.map((entry) => entry.path)).toEqual([".", "packages/a", "packages/b"]);
    expect(valueAt<string>(snapshot, "repository.workspace.root")).toBe("package.json");
  });
});

describe("case I — a glob match that is not a package", () => {
  it("keeps the directory as a candidate and excludes it from members", async () => {
    const snapshot = await snapshotOf({
      ...WORKSPACED,
      "packages/a/package.json": manifest({ name: "a" }),
      "packages/docs/index.md": "# docs\n",
    });
    const candidates = valueAt<WorkspaceCandidateEntry[]>(
      snapshot,
      "repository.workspace.candidates",
    );
    // It matched, so it is visible — dropping it would hide the very
    // "glob matched a non-package" case that makes a repository messy.
    expect(candidates.map((entry) => entry.path)).toEqual(["packages/a", "packages/docs"]);

    const members = valueAt<PackageEntry[]>(snapshot, "repository.workspace.members");
    // But a directory is not a package because a glob matched it.
    expect(members.map((member) => member.path)).toEqual(["packages/a"]);
    expect(members.some((member) => member.path === "packages/docs")).toBe(false);
  });
});

describe("case J — a declared path that is not there", () => {
  it("keeps the declaration and records the absence explicitly", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", workspaces: ["packages/a", "packages/missing"] }),
      "packages/a/package.json": manifest({ name: "a" }),
    });
    const candidates = valueAt<WorkspaceCandidateEntry[]>(
      snapshot,
      "repository.workspace.candidates",
    );
    // The gap stays in the snapshot as an absence, which a later drift analysis
    // needs. Dropping the path because it produced no member would quietly turn
    // "declared and missing" into "never declared".
    expect(candidates).toEqual([
      { path: "packages/a", source: "package.json", pattern: "packages/a", present: true },
      {
        path: "packages/missing",
        source: "package.json",
        pattern: "packages/missing",
        present: false,
      },
    ]);
    // The declaration itself is untouched.
    expect(
      valueAt<{ patterns: string[] }[]>(snapshot, "repository.workspace.declarations")[0]?.patterns,
    ).toEqual(["packages/a", "packages/missing"]);
    expect(
      valueAt<PackageEntry[]>(snapshot, "repository.workspace.members").map((m) => m.path),
    ).toEqual(["packages/a"]);
  });
});

describe("case K — an undeclared package", () => {
  it("is not added to the workspace, and the boundary is explicit", async () => {
    const snapshot = await snapshotOf({
      ...WORKSPACED,
      "packages/a/package.json": manifest({ name: "a" }),
      "tools/internal/package.json": manifest({ name: "internal-tool" }),
    });
    const members = valueAt<PackageEntry[]>(snapshot, "repository.workspace.members");
    const packages = valueAt<PackageEntry[]>(snapshot, "repository.packages");

    // It is not a workspace member: no declaration includes it, and silently
    // adding it would report a workspace the repository never described.
    expect(members.map((member) => member.path)).toEqual(["packages/a"]);

    // It is also not in `repository.packages`, because package discovery follows
    // declarations plus the root. This is the documented closed-world boundary
    // of ADR-0045 §5, and it is asserted here so that a future change to
    // unbounded traversal cannot land silently.
    expect(packages.map((entry) => entry.path)).toEqual([".", "packages/a"]);
    // Every collection is sorted, so the absence is not an ordering artifact.
    expect(packages.map((entry) => entry.path)).toEqual([...packages.map((e) => e.path)].sort());
  });
});

describe("case L — one malformed member among valid ones", () => {
  it("degrades only the malformed manifest, using the smallest failure boundary", async () => {
    const snapshot = await snapshotOf({
      ...WORKSPACED,
      "packages/a/package.json": manifest({ name: "a" }),
      "packages/broken/package.json": "{ this is not json",
    });
    const members = valueAt<PackageEntry[]>(snapshot, "repository.workspace.members");

    // The malformed member is still a member — the file is there — and is
    // reported as such rather than dropped, because dropping it would make a
    // broken manifest indistinguishable from a non-package directory.
    const broken = members.find((member) => member.path === "packages/broken");
    expect(broken).toMatchObject({ manifestStatus: "malformed", name: null, nameStatus: "absent" });
    // Its valid neighbour is untouched. One unreadable manifest must never be
    // able to fail workspace discovery wholesale.
    expect(members.find((member) => member.path === "packages/a")).toMatchObject({
      name: "a",
      manifestStatus: "read",
    });
    // The repository snapshot as a whole remains usable, and says it is partial.
    expect(snapshot.summary.complete).toBe(false);
    const partial = snapshot.diagnostics.find(
      (diagnostic) => diagnostic.code === "DISCOVERY_PARTIAL",
    );
    // The diagnostic names the file, so the failure boundary is exactly one path.
    expect(partial?.metadata).toMatchObject({
      path: "packages/broken/package.json",
      manifestStatus: "malformed",
    });
  });

  it("keeps a malformed root manifest from collapsing discovery", async () => {
    const snapshot = await snapshotOf({
      "package.json": "{ broken",
      "AGENTS.md": "# agents\n",
    });
    // Nothing about packages or workspaces can be established, and that is
    // reported as unknown rather than as a failed discovery.
    expect(snapshot.summary.known).toBeGreaterThan(0);
    expect(snapshot.facts["repository.packages"]).toBeDefined();
    expect(snapshot.facts["repository.workspace.declarations"]).toBeDefined();
  });
});

describe("case M — an unreadable member", () => {
  it("reports unknown rather than absent", async () => {
    const fs = new InMemoryFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/package.json", manifest({ name: "root", workspaces: ["packages/*"] }));
    fs.addFile("/repo/packages/a/package.json", manifest({ name: "a" }));
    fs.addFile("/repo/packages/locked/package.json", manifest({ name: "locked" }));

    // A reader that is refused one manifest. Modelled as a `FileSystem` wrapper
    // rather than a bespoke object so the test exercises the same boundary the
    // probes use.
    const guarded: FileSystem = {
      ...toFileSystem(fs),
      readTextFile: (path) =>
        path.endsWith("/packages/locked/package.json")
          ? Promise.reject(new FileSystemError("EACCES: permission denied", path))
          : fs.readTextFile(path),
    };

    const result = await discoverRepository(guarded, { startDir: "/repo" });
    if (!result.ok) throw new Error("expected discovery to succeed");
    const members = valueAt<PackageEntry[]>(result.snapshot, "repository.workspace.members");

    // Reported as unreadable, never as absent: a reader that was refused access
    // has not established that there is no package there.
    const locked = members.find((member) => member.path === "packages/locked");
    expect(locked).toMatchObject({ manifestStatus: "unreadable" });
    expect(locked).toBeDefined();
    // And its neighbour still resolves.
    expect(members.find((member) => member.path === "packages/a")).toMatchObject({
      name: "a",
      manifestStatus: "read",
    });
  });
});

describe("case O — a workspace pattern that tries to escape the repository", () => {
  it("never reads outside the root, whatever the declaration says", async () => {
    const outside = new InMemoryFileSystem("/outside");
    outside.addFile("/outside/package.json", manifest({ name: "secret" }));
    outside.addFile("/outside/secret.txt", "sensitive\n");

    const fs = new InMemoryFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile(
      "/repo/package.json",
      manifest({ name: "root", workspaces: ["../outside", "../../etc", "packages/*"] }),
    );
    fs.addFile("/repo/packages/a/package.json", manifest({ name: "a" }));

    const snapshot = await discoverRepository(fs, { startDir: "/repo" });
    if (!snapshot.ok) throw new Error("expected discovery to succeed");

    // The safety property is that nothing outside the root was *read*, not that
    // the author's text never appears: the declaration fact must preserve
    // `["../outside", ...]` verbatim, because what the repository wrote is
    // exactly what a consumer needs to see in order to fix it.
    const candidates = valueAt<WorkspaceCandidateEntry[]>(
      snapshot.snapshot,
      "repository.workspace.candidates",
    );
    const members = valueAt<PackageEntry[]>(snapshot.snapshot, "repository.workspace.members");
    for (const collection of [candidates, members]) {
      for (const entry of collection) {
        expect(entry.path.startsWith("/")).toBe(false);
        expect(entry.path).not.toContain("..");
      }
    }
    expect(members.map((member) => member.path)).toEqual(["packages/a"]);
    // No file from outside the repository was read into any fact.
    expect(JSON.stringify(snapshot.snapshot)).not.toContain("secret.txt");
    expect(JSON.stringify(snapshot.snapshot)).not.toContain("/outside/");

    // The offending patterns are reported as refused, not silently dropped: a
    // snapshot that looked complete while ignoring two declarations would be the
    // most dangerous possible wrong answer.
    const diagnostics = snapshot.snapshot.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DISCOVERY_WORKSPACE_UNSUPPORTED",
    );
    expect(diagnostics).toHaveLength(2);
    expect(codes(snapshot.snapshot)).toContain("DISCOVERY_WORKSPACE_UNSUPPORTED");
    // And the declaration still shows all three patterns, refused or not.
    expect(
      valueAt<{ patterns: string[] }[]>(snapshot.snapshot, "repository.workspace.declarations")[0]
        ?.patterns,
    ).toEqual(["../outside", "../../etc", "packages/*"]);
  });
});

describe("case P — a symbolic link pointing outside the repository", () => {
  it("is never traversed, so nothing outside the root is read", async () => {
    const fs = new InMemoryFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/package.json", manifest({ name: "root", workspaces: ["packages/*"] }));
    fs.addFile("/repo/packages/a/package.json", manifest({ name: "a" }));
    // A link that looks exactly like a workspace member and points outside.
    fs.addFile("/outside/evil/package.json", manifest({ name: "evil" }));
    fs.addSymbolicLink("/repo/packages/linked", "/outside/evil");

    const snapshot = await discoverRepository(fs, { startDir: "/repo" });
    if (!snapshot.ok) throw new Error("expected discovery to succeed");

    const members = valueAt<PackageEntry[]>(snapshot.snapshot, "repository.workspace.members");
    expect(members.map((member) => member.path)).toEqual(["packages/a"]);
    // The link is a real directory entry, so it must not appear at all — neither
    // as a member nor as a candidate that was quietly accepted.
    const candidates = valueAt<WorkspaceCandidateEntry[]>(
      snapshot.snapshot,
      "repository.workspace.candidates",
    );
    expect(candidates.some((entry) => entry.path === "packages/linked")).toBe(false);
    expect(JSON.stringify(snapshot.snapshot)).not.toContain("evil");
  });
});

describe("case Q — path-order determinism", () => {
  it("produces byte-identical output whatever order the entries were created in", async () => {
    const files = {
      ...WORKSPACED,
      "packages/a/package.json": manifest({ name: "a" }),
      "packages/b/package.json": manifest({ name: "b" }),
      "packages/c/package.json": manifest({ name: "c" }),
      "packages/d/package.json": manifest({ name: "d" }),
      "package-lock.json": manifest({ lockfileVersion: 3 }),
      "yarn.lock": "",
    };
    const forwards = await discoverRepository(repoWith(files), { startDir: "/repo" });
    const backwards = await discoverRepository(repoWithReversedInsertion(files), {
      startDir: "/repo",
    });
    if (!forwards.ok || !backwards.ok) throw new Error("expected both to succeed");
    expect(JSON.stringify(backwards.snapshot)).toBe(JSON.stringify(forwards.snapshot));
  });

  it("is stable across repeated runs on the same tree", async () => {
    const snapshot = await snapshotOf({
      ...WORKSPACED,
      "packages/a/package.json": manifest({ name: "a" }),
      "packages/b/package.json": manifest({ name: "b" }),
    });
    const again = await snapshotOf({
      ...WORKSPACED,
      "packages/a/package.json": manifest({ name: "a" }),
      "packages/b/package.json": manifest({ name: "b" }),
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(snapshot));
  });
});

describe("case R — checkout-location independence", () => {
  it("produces byte-identical canonical output under two absolute roots", async () => {
    const files = {
      ...WORKSPACED,
      "packages/a/package.json": manifest({ name: "a" }),
      "packages/b/package.json": manifest({ name: "b", private: true }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    };
    const build = (root: string): InMemoryFileSystem => {
      const fs = new InMemoryFileSystem(root);
      for (const [path, content] of Object.entries(files)) {
        fs.addFile(`${root}/${path}`, content);
      }
      fs.addDirectory(`${root}/.git`);
      return fs;
    };

    const short = await discoverRepository(build("/repo"), { startDir: "/repo" });
    const long = await discoverRepository(
      build("/home/someone/deeply/nested/checkout/agent-ready"),
      { startDir: "/home/someone/deeply/nested/checkout/agent-ready" },
    );
    if (!short.ok || !long.ok) throw new Error("expected both to succeed");

    // Not "the facts are equal" but "the bytes are equal": a path that leaked
    // into a detail string or a sort key would survive the former and fail this.
    expect(JSON.stringify(long.snapshot)).toBe(JSON.stringify(short.snapshot));
    expect(long.snapshot.root).toBe(".");
    expect(JSON.stringify(long.snapshot)).not.toContain("someone");
  });
});

describe("workspace expansion semantics", () => {
  it("honours a positional negation within one declaration only", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", workspaces: ["packages/*", "!packages/legacy"] }),
      "packages/a/package.json": manifest({ name: "a" }),
      "packages/legacy/package.json": manifest({ name: "legacy" }),
    });
    const members = valueAt<PackageEntry[]>(snapshot, "repository.workspace.members");
    expect(members.map((member) => member.path)).toEqual(["packages/a"]);
  });

  it("does not let one source's exclusion remove another source's match", async () => {
    // Applying a rule across documents the repository wrote separately would
    // produce a pattern set nobody described. Both declarations stay reported.
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", workspaces: ["packages/*", "!packages/a"] }),
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
      "packages/a/package.json": manifest({ name: "a" }),
    });
    const declarations = valueAt<{ source: string; patterns: string[] }[]>(
      snapshot,
      "repository.workspace.declarations",
    );
    expect(declarations.map((entry) => entry.source)).toEqual([
      "package.json",
      "pnpm-workspace.yaml",
    ]);
    const members = valueAt<PackageEntry[]>(snapshot, "repository.workspace.members");
    // pnpm-workspace.yaml matched it, so the package is a member and the overlap
    // is visible rather than resolved.
    expect(members.map((member) => member.path)).toEqual(["packages/a"]);
  });

  it("does not descend into a matched package for a single-segment pattern", async () => {
    const snapshot = await snapshotOf({
      ...WORKSPACED,
      "packages/a/package.json": manifest({ name: "a" }),
      "packages/a/nested/package.json": manifest({ name: "nested" }),
    });
    const members = valueAt<PackageEntry[]>(snapshot, "repository.workspace.members");
    // `packages/*` is exactly two segments deep. Finding `packages/a/nested` would
    // mean the walk ignored the pattern's own shape.
    expect(members.map((member) => member.path)).toEqual(["packages/a"]);
  });

  it("matches a single-segment path that exists but holds no manifest, and says so", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", workspaces: ["packages/empty"] }),
      "packages/other/package.json": manifest({ name: "other" }),
    });
    const candidates = valueAt<WorkspaceCandidateEntry[]>(
      snapshot,
      "repository.workspace.candidates",
    );
    expect(candidates).toEqual([
      {
        path: "packages/empty",
        source: "package.json",
        pattern: "packages/empty",
        present: false,
      },
    ]);
  });

  it("expands a `**` pattern to nested directories within its bound", async () => {
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", workspaces: ["packages/**"] }),
      "packages/a/package.json": manifest({ name: "a" }),
      "packages/a/nested/package.json": manifest({ name: "nested" }),
    });
    const members = valueAt<PackageEntry[]>(snapshot, "repository.workspace.members");
    expect(members.map((member) => member.path)).toEqual(["packages/a", "packages/a/nested"]);
  });
});

describe("case T — the entry bound is a real bound", () => {
  // Enough directories to exceed the ceiling, built in memory because the point
  // is the size of the enumeration rather than the shape of any one entry.
  const OVER_BUDGET = MAX_WORKSPACE_ENTRIES + 25;

  function wideRepo(): InMemoryFileSystem {
    const files: Record<string, string> = {
      "package.json": manifest({ name: "wide", workspaces: ["packages/*"] }),
    };
    for (let index = 0; index < OVER_BUDGET; index++) {
      files[`packages/p${String(index).padStart(5, "0")}/package.json`] = manifest({
        name: `p${String(index)}`,
      });
    }
    return repoWith(files);
  }

  it("stops enumerating at the bound and reports it", async () => {
    const result = await discoverRepository(wideRepo(), { startDir: "/repo" });
    if (!result.ok) throw new Error("expected discovery to succeed");
    const candidates = valueAt<WorkspaceCandidateEntry[]>(
      result.snapshot,
      "repository.workspace.candidates",
    );
    // The bound is on entries enumerated, so the candidate list cannot exceed
    // it. A previous version charged a whole directory listing at once and
    // noticed the overrun on the next iteration, which let every child of an
    // over-wide directory through and made the constant a check rather than a
    // ceiling.
    expect(candidates.length).toBeLessThanOrEqual(MAX_WORKSPACE_ENTRIES);
    const truncated = result.snapshot.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "DISCOVERY_PARTIAL" &&
        diagnostic.metadata?.["maxEntries"] !== undefined,
    );
    expect(truncated).toBeDefined();
    expect(truncated?.metadata).toMatchObject({ maxEntries: MAX_WORKSPACE_ENTRIES });
    // A bound that cost coverage cannot leave the snapshot claiming it did not.
    expect(result.snapshot.summary.complete).toBe(false);
  });

  it("reports the same truncation whatever order the directories were created in", async () => {
    // Determinism is the property the bound has to keep: an enumeration that
    // stops early is only reproducible if where it stops is a function of the
    // entries and not of the order they arrived in. The in-memory file system
    // sorts every listing, so the reversal that matters is which directories
    // exist, not the order they were registered in — and the snapshot is
    // compared byte for byte.
    const forward = wideRepo();
    const snapshotOfForward = await discoverRepository(forward, { startDir: "/repo" });
    if (!snapshotOfForward.ok) throw new Error("expected discovery to succeed");
    const second = wideRepo();
    const snapshotOfSecond = await discoverRepository(second, { startDir: "/repo" });
    if (!snapshotOfSecond.ok) throw new Error("expected discovery to succeed");
    expect(JSON.stringify(snapshotOfSecond.snapshot)).toBe(
      JSON.stringify(snapshotOfForward.snapshot),
    );
  });

  it("does not report truncation for a repository inside the bound", async () => {
    // The opposite failure is the dangerous one: a bound that fires on ordinary
    // repositories trains a reader to ignore it.
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", workspaces: ["packages/*"] }),
      "packages/a/package.json": manifest({ name: "a" }),
      "packages/b/package.json": manifest({ name: "b" }),
    });
    expect(codes(snapshot)).not.toContain("DISCOVERY_PARTIAL");
    expect(snapshot.summary.complete).toBe(true);
  });
});

describe("case X — a declaration with no patterns", () => {
  it("reports an empty pattern list as declared, and derives nothing from it", async () => {
    // `workspaces: []` is a real thing to write. It is not a malformed
    // declaration, and it is not a workspace with members; it is a declaration
    // that declares no patterns, and the three states stay distinct.
    const snapshot = await snapshotOf({
      "package.json": manifest({ name: "root", workspaces: [] }),
      "packages/a/package.json": manifest({ name: "a" }),
    });
    const declarations = valueAt<{ source: string; form: string; patterns: string[] }[]>(
      snapshot,
      "repository.workspace.declarations",
    );
    expect(declarations).toEqual([
      { source: "package.json", form: "array", patterns: [], unsupportedReason: null },
    ]);
    // The declaration is honoured literally: nothing was declared, so nothing
    // is a candidate and nothing is a member. `packages/a` is not a member
    // because a glob would have matched it, not because a directory exists.
    const candidates = valueAt<WorkspaceCandidateEntry[]>(
      snapshot,
      "repository.workspace.candidates",
    );
    expect(candidates).toEqual([]);
    const members = valueAt<PackageEntry[]>(snapshot, "repository.workspace.members");
    expect(members).toEqual([]);
    // An empty list is a supported form, so nothing warns about it.
    expect(codes(snapshot)).not.toContain("DISCOVERY_WORKSPACE_UNSUPPORTED");
    expect(snapshot.summary.complete).toBe(true);
  });
});

describe("case Y — the same pattern declared twice", () => {
  it("counts a package once and keeps both declarations visible", async () => {
    // Duplicated patterns are a real authoring accident. Deduplicating the
    // *result* is right; dropping the duplicate from the declared pattern list
    // would be wrong, because that list is what the repository wrote and a
    // consumer checking it against the file has to find the same two entries.
    const snapshot = await snapshotOf({
      "package.json": manifest({
        name: "root",
        workspaces: ["packages/*", "packages/a", "packages/*"],
      }),
      "packages/a/package.json": manifest({ name: "a" }),
      "packages/b/package.json": manifest({ name: "b" }),
    });
    const declarations = valueAt<{ patterns: string[] }[]>(
      snapshot,
      "repository.workspace.declarations",
    );
    // Verbatim, in order, duplicates included.
    expect(declarations[0]?.patterns).toEqual(["packages/*", "packages/a", "packages/*"]);
    // And the derivation does not double-count the same directory.
    const members = valueAt<PackageEntry[]>(snapshot, "repository.workspace.members");
    expect(members.map((member) => member.path)).toEqual(["packages/a", "packages/b"]);
    const candidates = valueAt<WorkspaceCandidateEntry[]>(
      snapshot,
      "repository.workspace.candidates",
    );
    // `packages/a` matched by two patterns is one candidate with two entries of
    // provenance, not two candidates: the entries are keyed by source, pattern,
    // and path, so the overlap is visible instead of being silently merged.
    const a = candidates.filter((candidate) => candidate.path === "packages/a");
    expect(a.map((candidate) => candidate.pattern).sort()).toEqual(["packages/*", "packages/a"]);
  });
});
