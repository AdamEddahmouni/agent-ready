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

describe("readDirectory", () => {
  it("lists immediate entries and classifies them, in both implementations", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-ready-fs-readdir-"));
    try {
      await mkdir(join(root, "nested"));
      await writeFile(join(root, "b.ts"), "export const b = 1;", "utf8");
      await writeFile(join(root, "a.ts"), "export const a = 1;", "utf8");
      await writeFile(join(root, "nested", "deep.ts"), "export const d = 1;", "utf8");

      const node = new NodeFileSystem();
      const memory = new InMemoryFileSystem("/repo");
      memory.addFile("/repo/b.ts", "export const b = 1;");
      memory.addFile("/repo/a.ts", "export const a = 1;");
      memory.addFile("/repo/nested/deep.ts", "export const d = 1;");

      const nodeEntries = await node.readDirectory(root);
      const memoryEntries = await memory.readDirectory("/repo");

      const shape = (entries: readonly { name: string; isFile: boolean; isDirectory: boolean }[]) =>
        entries.map(({ name, isFile, isDirectory }) => ({ name, isFile, isDirectory }));

      const expected = [
        { name: "a.ts", isFile: true, isDirectory: false },
        { name: "b.ts", isFile: true, isDirectory: false },
        { name: "nested", isFile: false, isDirectory: true },
      ];
      expect(shape(nodeEntries ?? [])).toEqual(expected);
      expect(shape(memoryEntries ?? [])).toEqual(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns undefined for a path that does not exist, in both implementations", async () => {
    const node = new NodeFileSystem();
    const memory = new InMemoryFileSystem("/repo");
    await expect(node.readDirectory(join(tmpdir(), "agent-ready-absent-directory"))).resolves.toBe(
      undefined,
    );
    await expect(memory.readDirectory("/repo/absent")).resolves.toBe(undefined);
  });

  it("reports a symlinked entry without following it", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-ready-fs-readdir-link-"));
    try {
      await mkdir(join(root, "real"));
      await writeFile(join(root, "real", "file.ts"), "export const f = 1;", "utf8");
      try {
        await symlink(join(root, "real"), join(root, "link"), "dir");
      } catch {
        return; // Windows without developer mode cannot create symlinks.
      }

      const entries = (await new NodeFileSystem().readDirectory(root)) ?? [];
      const link = entries.find((entry) => entry.name === "link");
      expect(link?.isSymbolicLink).toBe(true);
      expect(link?.isDirectory).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
