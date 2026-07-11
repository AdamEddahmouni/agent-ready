import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";

describe("InMemoryFileSystem.writeTextFile", () => {
  it("creates a file that did not exist before", async () => {
    const fs = new InMemoryFileSystem("/repo");
    await fs.writeTextFile("/repo/AGENTS.md", "hello");
    await expect(fs.readTextFile("/repo/AGENTS.md")).resolves.toBe("hello");
  });

  it("overwrites a file that already existed", async () => {
    const fs = new InMemoryFileSystem("/repo");
    fs.addFile("/repo/AGENTS.md", "old content");
    await fs.writeTextFile("/repo/AGENTS.md", "new content");
    await expect(fs.readTextFile("/repo/AGENTS.md")).resolves.toBe("new content");
  });

  it("round-trips through stat as a file after writing", async () => {
    const fs = new InMemoryFileSystem("/repo");
    await fs.writeTextFile("/repo/AGENTS.md", "hello");
    const stat = await fs.stat("/repo/AGENTS.md");
    expect(stat).toEqual({
      isFile: true,
      isDirectory: false,
      isSymbolicLink: false,
      sizeBytes: 5,
    });
  });
});
