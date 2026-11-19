import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assessShellMutation,
  shellMutationRisk,
} from "../../research/phase1-benchmark/harness/transcriptCapture.js";

const execFileAsync = promisify(execFile);
const CERTAIN = [{ command: "truncate -s -1 package.json", level: "certain" as const }];

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "phase1-shell-mutation-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function committedCheckout(files: readonly string[]): Promise<void> {
  await execFileAsync("git", ["init", "--quiet"], { cwd: directory });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: directory });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: directory });
  for (const file of files) await writeFile(join(directory, file), "{}\n", "utf8");
  await execFileAsync("git", ["add", ...files], { cwd: directory });
  await execFileAsync("git", ["commit", "--quiet", "-m", "base"], { cwd: directory });
}

describe("shell mutation assessment", () => {
  it("classifies the command a shell wrapper carries", () => {
    expect(shellMutationRisk('/bin/bash -lc "truncate -s -1 package.json"')).toBe("certain");
    expect(shellMutationRisk('/bin/bash -lc "git status --short"')).toBe("none");
    expect(shellMutationRisk('/bin/bash -lc "node ./patch.js"')).toBe("possible");
    expect(shellMutationRisk("/bin/bash -lc")).toBe("possible");
  });

  it("accepts a certain mutation when every changed path is recorded", async () => {
    await committedCheckout(["package.json"]);
    await writeFile(join(directory, "package.json"), '{"a":1}\n', "utf8");

    const assessment = await assessShellMutation({
      workspaceRoot: directory,
      recordedPaths: ["package.json"],
      commands: CERTAIN,
    });

    expect(assessment.refusal).toBeUndefined();
    expect(assessment.risk).toBe(false);
    expect(assessment.note).toContain("every path the checkout reports as changed is recorded");
  });

  it("refuses when the checkout has a change the transcript does not record", async () => {
    await committedCheckout(["package.json", "notes.txt"]);
    await writeFile(join(directory, "package.json"), '{"a":1}\n', "utf8");
    await writeFile(join(directory, "notes.txt"), "changed by bash\n", "utf8");

    const assessment = await assessShellMutation({
      workspaceRoot: directory,
      recordedPaths: ["package.json"],
      commands: CERTAIN,
    });

    expect(assessment.risk).toBe(true);
    expect(assessment.refusal).toContain("the checkout has changes the transcript does not record");
    expect(assessment.refusal).toContain('"notes.txt"');
    expect(assessment.refusal).not.toContain('"package.json"');
  });

  it("refuses an unverifiable checkout instead of assuming coverage", async () => {
    const assessment = await assessShellMutation({
      workspaceRoot: directory,
      recordedPaths: [],
      commands: CERTAIN,
    });

    expect(assessment.risk).toBe(true);
    expect(assessment.refusal).toContain("could not be checked");
  });

  it("flags an interpreter and names the unrecorded path without refusing it", async () => {
    await committedCheckout(["package.json"]);
    await writeFile(join(directory, "package.json"), '{"a":1}\n', "utf8");

    const assessment = await assessShellMutation({
      workspaceRoot: directory,
      recordedPaths: [],
      commands: [{ command: "node ./patch.js", level: "possible" }],
    });

    expect(assessment.refusal).toBeUndefined();
    expect(assessment.risk).toBe(true);
    expect(assessment.note).toContain('"package.json"');
  });

  it("does not consult git when no command looks mutating", async () => {
    const assessment = await assessShellMutation({
      workspaceRoot: join(directory, "missing"),
      recordedPaths: [],
      commands: [{ command: "cat package.json", level: "none" }],
    });

    expect(assessment).toEqual({ risk: false });
  });
});
