import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { readHandoff } from "../../src/verify/handoff.js";

const valid = {
  summary: "Summary",
  filesChanged: ["src/a.ts"],
  commandsRun: ["pnpm test"],
  assumptions: ["None"],
  knownIssues: [],
  requiresManualReview: false,
};

async function diagnosticFor(value: unknown): Promise<string | undefined> {
  const fs = new InMemoryFileSystem("/repo");
  fs.addFile("/repo/handoff.json", typeof value === "string" ? value : JSON.stringify(value));
  const result = await readHandoff(fs, "/repo/handoff.json");
  return result.ok ? undefined : result.diagnostics[0]?.code;
}

describe("readHandoff", () => {
  it("accepts exact Unicode character boundaries", async () => {
    expect(await diagnosticFor({ ...valid, summary: "😀".repeat(2000) })).toBeUndefined();
    expect(await diagnosticFor({ ...valid, knownIssues: ["😀".repeat(500)] })).toBeUndefined();
  });

  it.each([
    "summary",
    "filesChanged",
    "commandsRun",
    "assumptions",
    "knownIssues",
    "requiresManualReview",
  ])("rejects missing required field %s", async (field) => {
    const value = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== field));
    expect(await diagnosticFor(value)).toBe("HANDOFF_FILE_INVALID");
  });

  it.each([
    ["summary", 1],
    ["filesChanged", "src/a.ts"],
    ["commandsRun", [1]],
    ["assumptions", null],
    ["knownIssues", {}],
    ["requiresManualReview", "false"],
  ])("rejects the wrong type for %s", async (field, wrong) => {
    expect(await diagnosticFor({ ...valid, [field]: wrong })).toBe("HANDOFF_FILE_INVALID");
  });

  it("rejects malformed JSON, unknown fields, unreadable paths, and oversized files", async () => {
    expect(await diagnosticFor("{")).toBe("HANDOFF_FILE_INVALID");
    expect(await diagnosticFor({ ...valid, extra: true })).toBe("HANDOFF_FILE_INVALID");
    const fs = new InMemoryFileSystem("/repo");
    expect((await readHandoff(fs, "/repo/missing.json")).ok).toBe(false);
    fs.addFile("/repo/large.json", "x".repeat(64 * 1024 + 1));
    expect((await readHandoff(fs, "/repo/large.json")).ok).toBe(false);
  });

  it("distinguishes fields beyond their character boundaries", async () => {
    expect(await diagnosticFor({ ...valid, summary: "x".repeat(2001) })).toBe(
      "HANDOFF_FIELD_TOO_LONG",
    );
    expect(await diagnosticFor({ ...valid, assumptions: ["x".repeat(501)] })).toBe(
      "HANDOFF_FIELD_TOO_LONG",
    );
  });

  it("bounds array entry counts", async () => {
    expect(await diagnosticFor({ ...valid, filesChanged: Array(101).fill("a") })).toBe(
      "HANDOFF_FILE_INVALID",
    );
  });
});
