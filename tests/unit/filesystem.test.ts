import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";

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

describe("NodeFileSystem secure writes", () => {
  it.skipIf(process.platform === "win32")(
    "reports symlinks without following them and refuses write-through",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "agent-ready-fs-security-"));
      try {
        const target = join(root, "target.txt");
        const link = join(root, "link.txt");
        await writeFile(target, "preserve me", "utf8");
        await symlink(target, link, "file");
        const fs = new NodeFileSystem();
        await expect(fs.stat(link)).resolves.toMatchObject({ isSymbolicLink: true, isFile: false });
        await expect(fs.writeTextFile(link, "overwrite", { allowedRoot: root })).rejects.toThrow(
          "symbolic link",
        );
        await expect(readFile(target, "utf8")).resolves.toBe("preserve me");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("refuses a target whose real parent escapes the allowed root", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-ready-fs-root-"));
    const outside = await mkdtemp(join(tmpdir(), "agent-ready-fs-outside-"));
    try {
      const linkedDirectory = join(root, "linked");
      await mkdir(outside, { recursive: true });
      await symlink(outside, linkedDirectory, "junction");
      const fs = new NodeFileSystem();
      await expect(
        fs.writeTextFile(join(linkedDirectory, "escaped.txt"), "blocked", { allowedRoot: root }),
      ).rejects.toThrow("outside the allowed root");
      await expect(readFile(join(outside, "escaped.txt"), "utf8")).rejects.toThrow();
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });
});
