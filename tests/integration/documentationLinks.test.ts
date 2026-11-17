import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeDocumentation } from "../../src/analyze/analyzeDocumentation.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import { createTestRepo } from "./testRepo.js";

const repoRoot = process.cwd();

/**
 * Generated adapter output and examples describe a different repository root, so
 * their repository-relative links are resolved against that root, not this one.
 * They are validated by the adapter-output corpora instead. `.github` templates
 * are excluded from link resolution by the analyzer itself, which ignores
 * root-relative destinations.
 */
const EXCLUDED_DIRECTORIES: readonly string[] = [
  "compatibility",
  "coverage",
  "dist",
  "examples",
  "node_modules",
];

function isExcluded(entry: {
  readonly name: string;
  readonly isDirectory: () => boolean;
}): boolean {
  if (!entry.isDirectory()) return false;
  if (entry.name !== ".github" && entry.name.startsWith(".")) return true;
  return EXCLUDED_DIRECTORIES.includes(entry.name);
}

function collectMarkdownFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(repoRoot, directory), { withFileTypes: true })) {
    const relativePath = directory === "" ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (isExcluded(entry)) continue;
      files.push(...collectMarkdownFiles(relativePath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    files.push(relativePath.split(sep).join("/"));
  }
  return files;
}

describe("hand-written documentation links", () => {
  it("reports no broken relative links across the repository documentation surface", async () => {
    const sources = collectMarkdownFiles("");
    expect(sources).toContain("README.md");
    expect(sources).toContain("docs/decisions/0021-cli-package-maturity-direction.md");

    const result = await analyzeDocumentation(new NodeFileSystem(), repoRoot, sources);
    expect(result.diagnostics.map((diagnostic) => diagnostic.summary)).toEqual([]);
    expect(result.linksChecked).toBeGreaterThan(300);
  });

  it("excludes generated adapter output and fixtures from that surface", () => {
    const sources = collectMarkdownFiles("");
    expect(sources.some((path) => path.startsWith("compatibility/"))).toBe(false);
    expect(sources.some((path) => path.startsWith("examples/"))).toBe(false);
  });

  it("fails on a deliberately broken relative link", async () => {
    const repo = await createTestRepo({
      "README.md": "See [the missing guide](docs/missing.md).\n",
    });
    try {
      const result = await analyzeDocumentation(new NodeFileSystem(), repo.root, ["README.md"]);
      expect(result.findings).toEqual([
        expect.objectContaining({ kind: "broken", resolvedPath: "docs/missing.md" }),
      ]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "DOCUMENTATION_LINK_BROKEN",
      ]);
    } finally {
      await repo.cleanup();
    }
  });
});
