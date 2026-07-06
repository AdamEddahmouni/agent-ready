import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import {
  detectAll,
  detectNodeRangeFromHintFiles,
  detectPackageManagerFromLockFiles,
} from "../../src/cli/commands/initDetect.js";

function fs(root = "/repo"): InMemoryFileSystem {
  return new InMemoryFileSystem(root);
}

// ── Project name ───────────────────────────────────────────────────────────

describe("detectAll — project name", () => {
  it("uses package.json 'name' when present and valid", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "my-project" }));
    const result = await detectAll(fsys, "/repo");
    expect(result.projectName).toBe("my-project");
    expect(result.projectNameSource).toBe("package.json");
    expect(result.projectNameSanitized).toBe(false);
  });

  it("strips npm scope prefix (@scope/) from package.json name", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "@acme/my-project" }));
    const result = await detectAll(fsys, "/repo");
    expect(result.projectName).toBe("my-project");
    expect(result.projectNameSource).toBe("package.json");
    expect(result.projectNameSanitized).toBe(false);
  });

  it("falls back to directory name when no package.json exists", async () => {
    const fsys = fs();
    const result = await detectAll(fsys, "/my-repo");
    expect(result.projectName).toBe("my-repo");
    expect(result.projectNameSource).toBe("directory");
    expect(result.projectNameSanitized).toBe(false);
  });

  it("falls back to directory name when package.json has no 'name'", async () => {
    const fsys = fs("/my-repo");
    fsys.addFile("/my-repo/package.json", JSON.stringify({ version: "1.0.0" }));
    const result = await detectAll(fsys, "/my-repo");
    expect(result.projectName).toBe("my-repo");
    expect(result.projectNameSource).toBe("directory");
    expect(result.projectNameSanitized).toBe(false);
  });

  it("allows valid package.json names with internal spaces (matches schema pattern)", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "my project name" }));
    const result = await detectAll(fsys, "/repo");
    // The pattern ^\S(?:.*\S)?$ starts with non-whitespace and ends with
    // non-whitespace, which "my project name" satisfies.
    expect(result.projectName).toBe("my project name");
    expect(result.projectNameSource).toBe("package.json");
    expect(result.projectNameSanitized).toBe(false);
  });

  it("sanitizes an invalid package.json name (leading whitespace)", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "  leading-space" }));
    const result = await detectAll(fsys, "/repo");
    // Leading whitespace violates ^\S, so it gets sanitized.
    expect(result.projectName).toBe("leading-space");
    expect(result.projectNameSource).toBe("package.json");
    expect(result.projectNameSanitized).toBe(true);
  });
});

// ── Project description ────────────────────────────────────────────────────

describe("detectAll — project description", () => {
  it("includes description from package.json when present", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "test", description: "A test project description." }),
    );
    const result = await detectAll(fsys, "/repo");
    expect(result.projectDescription).toBe("A test project description.");
  });

  it("omits description when package.json has none", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    const result = await detectAll(fsys, "/repo");
    expect(result.projectDescription).toBeUndefined();
  });

  it("omits description when package.json has an empty string", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test", description: "" }));
    const result = await detectAll(fsys, "/repo");
    expect(result.projectDescription).toBeUndefined();
  });
});

// ── Node runtime ───────────────────────────────────────────────────────────

describe("detectAll — node range", () => {
  it("detects from package.json engines.node", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test", engines: { node: ">=20" } }));
    const result = await detectAll(fsys, "/repo");
    expect(result.nodeRange).toBe(">=20");
    expect(result.nodeRangeSource).toBe("engines.node");
  });

  it("ignores engines.node when value is '*' (wildcard)", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test", engines: { node: "*" } }));
    const result = await detectAll(fsys, "/repo");
    expect(result.nodeRange).toBeUndefined();
    expect(result.nodeRangeSource).toBeUndefined();
  });

  it("returns undefined when no engines field exists", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    const result = await detectAll(fsys, "/repo");
    expect(result.nodeRange).toBeUndefined();
    expect(result.nodeRangeSource).toBeUndefined();
  });
});

// ── Node range from hint files ─────────────────────────────────────────────

describe("detectNodeRangeFromHintFiles", () => {
  it("reads and converts a single-part version from .nvmrc", async () => {
    const fsys = fs();
    fsys.addFile("/repo/.nvmrc", "20");
    const result = await detectNodeRangeFromHintFiles(fsys, "/repo");
    expect(result.range).toBe(">=20 <21");
    expect(result.source).toBe(".nvmrc");
  });

  it("reads and converts a two-part version from .nvmrc", async () => {
    const fsys = fs();
    fsys.addFile("/repo/.nvmrc", "20.10");
    const result = await detectNodeRangeFromHintFiles(fsys, "/repo");
    expect(result.range).toBe(">=20.10 <20.11");
    expect(result.source).toBe(".nvmrc");
  });

  it("reads and converts a three-part version from .nvmrc", async () => {
    const fsys = fs();
    fsys.addFile("/repo/.nvmrc", "20.10.0");
    const result = await detectNodeRangeFromHintFiles(fsys, "/repo");
    expect(result.range).toBe(">=20.10.0 <21");
    expect(result.source).toBe(".nvmrc");
  });

  it("strips leading 'v' from .nvmrc version", async () => {
    const fsys = fs();
    fsys.addFile("/repo/.nvmrc", "v20.10.0");
    const result = await detectNodeRangeFromHintFiles(fsys, "/repo");
    expect(result.range).toBe(">=20.10.0 <21");
  });

  it("falls back to .node-version when .nvmrc is absent", async () => {
    const fsys = fs();
    fsys.addFile("/repo/.node-version", "22");
    const result = await detectNodeRangeFromHintFiles(fsys, "/repo");
    expect(result.range).toBe(">=22 <23");
    expect(result.source).toBe(".node-version");
  });

  it("prefers .nvmrc over .node-version when both exist", async () => {
    const fsys = fs();
    fsys.addFile("/repo/.nvmrc", "20");
    fsys.addFile("/repo/.node-version", "22");
    const result = await detectNodeRangeFromHintFiles(fsys, "/repo");
    expect(result.range).toBe(">=20 <21");
    expect(result.source).toBe(".nvmrc");
  });

  it("returns empty when neither hint file exists", async () => {
    const fsys = fs();
    const result = await detectNodeRangeFromHintFiles(fsys, "/repo");
    expect(result.range).toBeUndefined();
    expect(result.source).toBeUndefined();
  });
});

// ── Package manager ────────────────────────────────────────────────────────

describe("detectAll — package manager from packageManager field", () => {
  it("detects pnpm from package.json packageManager field", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "test", packageManager: "pnpm@10.5.0" }),
    );
    const result = await detectAll(fsys, "/repo");
    expect(result.packageManager).toEqual({ name: "pnpm", version: "10.5.0" });
    expect(result.packageManagerSource).toBe("package.json");
  });

  it("detects yarn from package.json packageManager field", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "test", packageManager: "yarn@4.0.0" }),
    );
    const result = await detectAll(fsys, "/repo");
    expect(result.packageManager).toEqual({ name: "yarn", version: "4.0.0" });
    expect(result.packageManagerSource).toBe("package.json");
  });

  it("detects npm from package.json packageManager field", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "test", packageManager: "npm@10.0.0" }),
    );
    const result = await detectAll(fsys, "/repo");
    expect(result.packageManager).toEqual({ name: "npm", version: "10.0.0" });
    expect(result.packageManagerSource).toBe("package.json");
  });

  it("returns undefined when packageManager field is absent", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    const result = await detectAll(fsys, "/repo");
    expect(result.packageManager).toBeUndefined();
    expect(result.packageManagerSource).toBeUndefined();
  });

  it("returns undefined when packageManager field has invalid format", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "test", packageManager: "bun@1.0.0" }),
    );
    const result = await detectAll(fsys, "/repo");
    expect(result.packageManager).toBeUndefined();
  });
});

describe("detectPackageManagerFromLockFiles", () => {
  it("detects pnpm from pnpm-lock.yaml", async () => {
    const fsys = fs();
    fsys.addFile("/repo/pnpm-lock.yaml", "");
    const result = await detectPackageManagerFromLockFiles(fsys, "/repo");
    expect(result).toEqual({ name: "pnpm", version: "10", source: "pnpm-lock.yaml" });
  });

  it("detects yarn from yarn.lock", async () => {
    const fsys = fs();
    fsys.addFile("/repo/yarn.lock", "");
    const result = await detectPackageManagerFromLockFiles(fsys, "/repo");
    expect(result).toEqual({ name: "yarn", version: "1", source: "yarn.lock" });
  });

  it("detects npm from package-lock.json", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package-lock.json", "");
    const result = await detectPackageManagerFromLockFiles(fsys, "/repo");
    expect(result).toEqual({ name: "npm", version: "10", source: "package-lock.json" });
  });

  it("prefers pnpm-lock.yaml over other lock files", async () => {
    const fsys = fs();
    fsys.addFile("/repo/pnpm-lock.yaml", "");
    fsys.addFile("/repo/package-lock.json", "");
    fsys.addFile("/repo/yarn.lock", "");
    const result = await detectPackageManagerFromLockFiles(fsys, "/repo");
    expect(result?.name).toBe("pnpm");
  });

  it("returns undefined when no lock files exist", async () => {
    const fsys = fs();
    const result = await detectPackageManagerFromLockFiles(fsys, "/repo");
    expect(result).toBeUndefined();
  });
});

// ── Scripts ────────────────────────────────────────────────────────────────

describe("detectAll — scripts", () => {
  it("includes only well-known script keys from package.json", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({
        name: "test",
        scripts: {
          lint: "eslint .",
          test: "vitest",
          build: "tsc",
          typecheck: "tsc --noEmit",
          format: "prettier --write .",
          check: "pnpm lint && pnpm test",
          "test-e2e": "playwright test",
          ci: "pnpm lint && pnpm test && pnpm build",
          dev: "vite",
          start: "node dist/index.js",
          clean: "rm -rf dist",
        },
      }),
    );
    const result = await detectAll(fsys, "/repo");
    expect(result.detectedScripts).toEqual({
      lint: "eslint .",
      test: "vitest",
      build: "tsc",
      typecheck: "tsc --noEmit",
      format: "prettier --write .",
      check: "pnpm lint && pnpm test",
      "test-e2e": "playwright test",
      ci: "pnpm lint && pnpm test && pnpm build",
    });
    expect(result.skippedScripts).toEqual(["dev", "start", "clean"]);
  });

  it("returns empty detectedScripts when no scripts in package.json", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    const result = await detectAll(fsys, "/repo");
    expect(result.detectedScripts).toEqual({});
    expect(result.skippedScripts).toEqual([]);
  });

  it("returns empty detectedScripts when no package.json exists", async () => {
    const fsys = fs();
    const result = await detectAll(fsys, "/repo");
    expect(result.detectedScripts).toEqual({});
    expect(result.skippedScripts).toEqual([]);
  });

  it("skips scripts with non-string values", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "test", scripts: { lint: "eslint .", bad: 123 } }),
    );
    const result = await detectAll(fsys, "/repo");
    expect(result.detectedScripts).toEqual({ lint: "eslint ." });
    expect(result.skippedScripts).toEqual([]);
  });

  it("skips script keys with empty string values", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test", scripts: { lint: "" } }));
    const result = await detectAll(fsys, "/repo");
    expect(result.detectedScripts).toEqual({});
    expect(result.skippedScripts).toEqual([]);
  });
});

// ── Verification scripts ───────────────────────────────────────────────────

describe("detectAll — verification scripts", () => {
  it("selects lint → typecheck → test → build in package.json script order", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc", test: "vitest", lint: "eslint .", typecheck: "tsc --noEmit" },
      }),
    );
    const result = await detectAll(fsys, "/repo");
    // Preserves the order they appear in package.json scripts.
    expect(result.verificationScripts).toEqual(["build", "test", "lint", "typecheck"]);
  });

  it("returns empty when no verification-relevant scripts exist", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "test", scripts: { dev: "vite", start: "node ." } }),
    );
    const result = await detectAll(fsys, "/repo");
    expect(result.verificationScripts).toEqual([]);
  });

  it("returns empty when scripts field is not an object", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test", scripts: "not-an-object" }));
    const result = await detectAll(fsys, "/repo");
    expect(result.verificationScripts).toEqual([]);
  });
});

// ── Documentation sources ──────────────────────────────────────────────────

describe("detectAll — doc sources", () => {
  it("detects README.md and CONTRIBUTING.md at repo root", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/README.md", "# Readme");
    fsys.addFile("/repo/CONTRIBUTING.md", "# Contributing");
    const result = await detectAll(fsys, "/repo");
    expect(result.docSources).toContain("README.md");
    expect(result.docSources).toContain("CONTRIBUTING.md");
  });

  it("returns empty when no doc files exist", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    const result = await detectAll(fsys, "/repo");
    expect(result.docSources).toEqual([]);
  });

  it("detects common .md files under docs/ when the docs/ directory exists", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addDirectory("/repo/docs");
    fsys.addFile("/repo/docs/architecture.md", "# Architecture");
    const result = await detectAll(fsys, "/repo");
    expect(result.docSources).toContain("docs/architecture.md");
  });
});

// ── Paths (.gitignore) ─────────────────────────────────────────────────────

describe("detectAll — paths from .gitignore", () => {
  it("extracts supported patterns from .gitignore", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.gitignore", "node_modules/\ndist/\ncoverage/\n");
    const result = await detectAll(fsys, "/repo");
    expect(result.ignoredPatterns).toEqual(["node_modules/", "dist/", "coverage/"]);
    expect(result.skippedGitignorePatterns).toEqual([]);
  });

  it("detects .env* patterns for protected-path suggestion", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.gitignore", "node_modules/\n.env\n");
    const result = await detectAll(fsys, "/repo");
    expect(result.hasEnvInGitignore).toBe(true);
  });

  it("detects .env* for protected-path suggestion", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.gitignore", ".env*");
    const result = await detectAll(fsys, "/repo");
    expect(result.hasEnvInGitignore).toBe(true);
  });

  it("hasEnvInGitignore is false when .env* is not in .gitignore", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.gitignore", "node_modules/");
    const result = await detectAll(fsys, "/repo");
    expect(result.hasEnvInGitignore).toBe(false);
  });

  it("skips unsupported glob syntax (extglobs)", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.gitignore", "node_modules/\n@(dist|build)/\n");
    const result = await detectAll(fsys, "/repo");
    expect(result.ignoredPatterns).toEqual(["node_modules/"]);
    expect(result.skippedGitignorePatterns).toEqual(["@(dist|build)/"]);
  });

  it("skips negation patterns", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.gitignore", "dist/\n!dist/keep.txt");
    const result = await detectAll(fsys, "/repo");
    expect(result.ignoredPatterns).toEqual(["dist/"]);
    expect(result.skippedGitignorePatterns).toContain("!dist/keep.txt");
  });

  it("skips comment lines and blank lines", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.gitignore", "# comment\n\nnode_modules/\n\n# another comment\ndist/\n");
    const result = await detectAll(fsys, "/repo");
    expect(result.ignoredPatterns).toEqual(["node_modules/", "dist/"]);
  });

  it("returns empty when no .gitignore exists", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    const result = await detectAll(fsys, "/repo");
    expect(result.ignoredPatterns).toEqual([]);
    expect(result.hasEnvInGitignore).toBe(false);
  });
});

// ── Minimal repo ───────────────────────────────────────────────────────────

describe("detectAll — minimal repo", () => {
  it("produces a detection with only project name from directory when empty", async () => {
    const fsys = fs("/my-repo");
    const result = await detectAll(fsys, "/my-repo");
    expect(result.projectName).toBe("my-repo");
    expect(result.projectNameSource).toBe("directory");
    expect(result.projectNameSanitized).toBe(false);
    expect(result.projectDescription).toBeUndefined();
    expect(result.nodeRange).toBeUndefined();
    expect(result.packageManager).toBeUndefined();
    expect(result.detectedScripts).toEqual({});
    expect(result.skippedScripts).toEqual([]);
    expect(result.verificationScripts).toEqual([]);
    expect(result.docSources).toEqual([]);
    expect(result.ignoredPatterns).toEqual([]);
    expect(result.hasEnvInGitignore).toBe(false);
  });
});
