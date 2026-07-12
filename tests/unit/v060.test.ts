import { describe, expect, it } from "vitest";
import { runVerify, VERIFICATION_RECORD_FILENAME } from "../../src/cli/commands/verify.js";
import { runGenerate } from "../../src/cli/commands/generate.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { FakeCommandRunner } from "../../src/verify/fakeCommandRunner.js";
import { loadContract } from "../../src/contract/pipeline.js";

const baseContract = `version: 1
project:
  name: example
commands:
  lint:
    run: pnpm lint
    timeout: 12
  test:
    run: pnpm test
verification:
  required:
    - lint
    - test
adapters:
  agentsMd:
    enabled: true
`;

function fixture(): InMemoryFileSystem {
  const fs = new InMemoryFileSystem("/repo");
  fs.addFile("/repo/agent-ready.yaml", baseContract);
  return fs;
}

describe("v0.6.0 verification additions", () => {
  it("validates and normalizes command timeout boundaries", async () => {
    const fs = fixture();
    const loaded = await loadContract({ fs, startDir: "/repo" });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.contract.commands[0]).toMatchObject({ timeout: 12 });

    fs.addFile("/repo/agent-ready.yaml", baseContract.replace("timeout: 12", "timeout: 0"));
    expect((await loadContract({ fs, startDir: "/repo" })).ok).toBe(false);
    fs.addFile("/repo/agent-ready.yaml", baseContract.replace("timeout: 12", "timeout: 3601"));
    expect((await loadContract({ fs, startDir: "/repo" })).ok).toBe(false);
    fs.addFile("/repo/agent-ready.yaml", baseContract.replace("timeout: 12", "timeout: 1.5"));
    expect((await loadContract({ fs, startDir: "/repo" })).ok).toBe(false);
  });

  it("resolves command timeout before CLI timeout and the default", async () => {
    const fs = fixture();
    const runner = new FakeCommandRunner();
    await runVerify(fs, runner, { json: true, execute: true, timeoutSeconds: 30 }, "/repo");
    expect(runner.optionsSeen.map((option) => option.timeoutMs)).toEqual([12_000, 30_000]);

    fs.addFile("/repo/agent-ready.yaml", baseContract.replace("    timeout: 12\n", ""));
    const defaults = new FakeCommandRunner();
    await runVerify(fs, defaults, { json: true, execute: true }, "/repo");
    expect(defaults.optionsSeen.map((option) => option.timeoutMs)).toEqual([900_000, 900_000]);
  });

  it("validates handoff without --record and records the versioned value when requested", async () => {
    const fs = fixture();
    const handoff = {
      summary: "Implemented ✓",
      filesChanged: ["src/a.ts"],
      commandsRun: ["pnpm test"],
      assumptions: [],
      knownIssues: [],
      requiresManualReview: false,
    };
    fs.addFile("/repo/handoff.json", JSON.stringify(handoff));
    const runner = new FakeCommandRunner();
    const valid = await runVerify(
      fs,
      runner,
      { json: true, execute: true, handoffPath: "handoff.json", record: true },
      "/repo",
    );
    expect(valid.exitCode).toBe(0);
    const evidence = JSON.parse(await fs.readTextFile(`/repo/${VERIFICATION_RECORD_FILENAME}`)) as {
      handoff: { version: number; summary: string };
    };
    expect(evidence.handoff).toMatchObject({ version: 1, summary: "Implemented ✓" });

    fs.addFile("/repo/bad.json", JSON.stringify({ ...handoff, extra: true }));
    const badRunner = new FakeCommandRunner();
    const invalid = await runVerify(
      fs,
      badRunner,
      { json: true, execute: true, handoffPath: "bad.json" },
      "/repo",
    );
    expect(badRunner.calls).toHaveLength(0);
    expect(invalid.stdout).toContain("HANDOFF_FILE_INVALID");
  });

  it("rejects oversized handoff fields with a stable diagnostic", async () => {
    const fs = fixture();
    fs.addFile(
      "/repo/handoff.json",
      JSON.stringify({
        summary: "x".repeat(2001),
        filesChanged: [],
        commandsRun: [],
        assumptions: [],
        knownIssues: [],
        requiresManualReview: true,
      }),
    );
    const outcome = await runVerify(
      fs,
      new FakeCommandRunner(),
      { json: true, execute: true, handoffPath: "handoff.json" },
      "/repo",
    );
    expect(outcome.stdout).toContain("HANDOFF_FIELD_TOO_LONG");
  });

  it("checks generated drift before executing commands and records the preflight", async () => {
    const fs = fixture();
    await runGenerate(fs, { json: true, write: true, check: false, force: false }, "/repo");
    fs.addFile("/repo/AGENTS.md", "stale\n");
    const runner = new FakeCommandRunner();
    const outcome = await runVerify(
      fs,
      runner,
      { json: true, execute: true, checkGenerate: true, record: true },
      "/repo",
    );
    expect(runner.calls).toHaveLength(0);
    const body = JSON.parse(outcome.stdout) as { generatePreflight: { ok: boolean } };
    expect(body.generatePreflight.ok).toBe(false);
    expect(outcome.stdout).toContain("GENERATED_FILES_OUT_OF_DATE");
    const evidence = JSON.parse(await fs.readTextFile(`/repo/${VERIFICATION_RECORD_FILENAME}`)) as {
      generatePreflight: { ok: boolean };
    };
    expect(evidence.generatePreflight.ok).toBe(false);
  });

  it("executes commands after a clean generated-file preflight", async () => {
    const fs = fixture();
    await runGenerate(fs, { json: true, write: true, check: false, force: false }, "/repo");
    const runner = new FakeCommandRunner();
    const outcome = await runVerify(
      fs,
      runner,
      { json: true, execute: true, checkGenerate: true },
      "/repo",
    );
    expect(outcome.exitCode).toBe(0);
    expect(runner.calls.map((call) => call.id)).toEqual(["lint", "test"]);
  });
});
