import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createTestRepo } from "./testRepo.js";

const execFile = promisify(execFileCallback);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("release helper scripts", () => {
  it("accepts only immutable third-party action references in release files", async () => {
    const result = await execFile(process.execPath, ["scripts/check-action-pins.mjs"]);
    expect(result.stdout).toMatch(/Verified immutable pins in \d+ action files\./u);
    expect(result.stderr).toBe("");
  });

  it("extracts version-specific changelog notes and release-asset guidance", async () => {
    const temp = await createTestRepo({});
    cleanups.push(temp.cleanup);
    const outputPath = join(temp.root, "notes.md");

    await execFile(process.execPath, [
      "scripts/extract-release-notes.mjs",
      "0.4.0-beta.4",
      outputPath,
    ]);
    const notes = await readFile(outputPath, "utf8");
    expect(notes).toContain("# Agent-Ready 0.4.0-beta.4");
    expect(notes).toContain("### Fixed");
    expect(notes).toContain("## Release assets");
    expect(notes).not.toContain("## 0.3.0");
  });

  it("fails when release notes are requested for an undocumented version", async () => {
    const temp = await createTestRepo({});
    cleanups.push(temp.cleanup);
    const outputPath = join(temp.root, "notes.md");

    await expect(
      execFile(process.execPath, ["scripts/extract-release-notes.mjs", "99.99.99", outputPath]),
    ).rejects.toThrow(/no section for 99\.99\.99/u);
  });
});
