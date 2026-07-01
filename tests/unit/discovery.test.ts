import { describe, expect, it } from "vitest";
import { discoverRepositoryContext } from "../../src/contract/discovery.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";

describe("discoverRepositoryContext", () => {
  it("finds the contract in the start directory", async () => {
    const fs = new InMemoryFileSystem("/repo");
    fs.addFile("/repo/agent-ready.yaml", "version: 1");
    const result = await discoverRepositoryContext(fs, { startDir: "/repo" });
    expect("context" in result).toBe(true);
    if ("context" in result) {
      expect(result.context.repoRoot).toBe("/repo");
      expect(result.context.contractPath).toBe("/repo/agent-ready.yaml");
    }
  });

  it("finds the contract from a nested working directory", async () => {
    const fs = new InMemoryFileSystem("/repo/src/nested");
    fs.addFile("/repo/agent-ready.yaml", "version: 1");
    fs.addDirectory("/repo/src/nested");
    const result = await discoverRepositoryContext(fs, { startDir: "/repo/src/nested" });
    expect("context" in result).toBe(true);
    if ("context" in result) {
      expect(result.context.repoRoot).toBe("/repo");
    }
  });

  it("reports not found when no contract exists anywhere up the tree", async () => {
    const fs = new InMemoryFileSystem("/repo/src");
    const result = await discoverRepositoryContext(fs, { startDir: "/repo/src" });
    expect("diagnostic" in result).toBe(true);
    if ("diagnostic" in result) {
      expect(result.diagnostic.code).toBe("CONTRACT_NOT_FOUND");
    }
  });

  it("stops searching at a .git boundary without a contract", async () => {
    const fs = new InMemoryFileSystem("/repo/src");
    fs.addDirectory("/repo/.git");
    // A contract exists further up, outside the git boundary, but must not be found.
    fs.addFile("/outer-agent-ready.yaml", "version: 1");
    const result = await discoverRepositoryContext(fs, { startDir: "/repo/src" });
    expect("diagnostic" in result).toBe(true);
  });

  it("does not require git: searches to the file-system root in non-git trees", async () => {
    const fs = new InMemoryFileSystem("/a/b/c");
    fs.addFile("/a/agent-ready.yaml", "version: 1");
    const result = await discoverRepositoryContext(fs, { startDir: "/a/b/c" });
    expect("context" in result).toBe(true);
    if ("context" in result) {
      expect(result.context.repoRoot).toBe("/a");
    }
  });

  it("uses the directory containing an explicit --config path", async () => {
    const fs = new InMemoryFileSystem("/repo");
    fs.addFile("/repo/custom/contract.yaml", "version: 1");
    const result = await discoverRepositoryContext(fs, {
      explicitConfigPath: "/repo/custom/contract.yaml",
    });
    expect("context" in result).toBe(true);
    if ("context" in result) {
      expect(result.context.repoRoot).toBe("/repo/custom");
      expect(result.context.contractPath).toBe("/repo/custom/contract.yaml");
    }
  });

  it("reports not found for a missing explicit --config path", async () => {
    const fs = new InMemoryFileSystem("/repo");
    const result = await discoverRepositoryContext(fs, {
      explicitConfigPath: "/repo/does-not-exist.yaml",
    });
    expect("diagnostic" in result).toBe(true);
    if ("diagnostic" in result) {
      expect(result.diagnostic.code).toBe("CONTRACT_NOT_FOUND");
    }
  });
});
