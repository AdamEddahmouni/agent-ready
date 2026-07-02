import { describe, expect, it } from "vitest";
import { runVerify } from "../../src/cli/commands/verify.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { FakeCommandRunner } from "../../src/verify/fakeCommandRunner.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";

function contractFs(
  options: {
    readonly commands?: Readonly<Record<string, string>>;
    readonly required?: readonly string[];
    readonly noVerification?: boolean;
  } = {},
): InMemoryFileSystem {
  const commands = options.commands ?? { install: "pnpm install", lint: "pnpm lint" };
  const required = options.required ?? Object.keys(commands);

  const commandsYaml = Object.entries(commands)
    .map(([id, run]) => `  ${id}:\n    run: ${run}`)
    .join("\n");

  const lines = ["version: 1", "project:", "  name: example", "commands:", commandsYaml];
  if (!options.noVerification) {
    lines.push("verification:", "  required:", ...required.map((id) => `    - ${id}`));
  }
  lines.push("");

  const fs = new InMemoryFileSystem("/repo");
  fs.addFile("/repo/agent-ready.yaml", lines.join("\n"));
  return fs;
}

describe("runVerify", () => {
  it("dry run prints the ordered plan and executes nothing", async () => {
    const fs = contractFs();
    const runner = new FakeCommandRunner();
    const outcome = await runVerify(fs, runner, { json: true, execute: false }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(runner.calls).toHaveLength(0);
    const parsed = JSON.parse(outcome.stdout) as {
      mode: string;
      commands: { id: string; status: string }[];
    };
    expect(parsed.mode).toBe("dry-run");
    expect(parsed.commands).toEqual([
      { id: "install", run: "pnpm install", status: "planned", exitCode: null, durationMs: 0 },
      { id: "lint", run: "pnpm lint", status: "planned", exitCode: null, durationMs: 0 },
    ]);
  });

  it("dry run human output lists commands and never executes", async () => {
    const fs = contractFs();
    const runner = new FakeCommandRunner();
    const outcome = await runVerify(fs, runner, { json: false, execute: false }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(runner.calls).toHaveLength(0);
    expect(outcome.stdout).toContain("1. install: pnpm install");
    expect(outcome.stdout).toContain("2. lint: pnpm lint");
    expect(outcome.stdout).toContain("Nothing was executed");
  });

  it("execute mode runs every command in order when all pass", async () => {
    const fs = contractFs();
    const runner = new FakeCommandRunner();
    const outcome = await runVerify(fs, runner, { json: true, execute: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(runner.calls.map((c) => c.id)).toEqual(["install", "lint"]);
    const parsed = JSON.parse(outcome.stdout) as { ok: boolean; commands: { status: string }[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.commands.map((c) => c.status)).toEqual(["passed", "passed"]);
  });

  it("stops at the first failure and marks the rest skipped", async () => {
    const fs = contractFs({
      commands: { install: "pnpm install", lint: "pnpm lint", test: "pnpm test" },
    });
    const runner = new FakeCommandRunner({ statusById: { lint: "failed" } });
    const outcome = await runVerify(fs, runner, { json: true, execute: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    expect(runner.calls.map((c) => c.id)).toEqual(["install", "lint"]);
    const parsed = JSON.parse(outcome.stdout) as {
      commands: { id: string; status: string }[];
      diagnostics: { code: string }[];
    };
    expect(parsed.commands.map((c) => c.status)).toEqual(["passed", "failed", "skipped"]);
    expect(parsed.diagnostics[0]?.code).toBe("VERIFICATION_COMMAND_FAILED");
  });

  it("reports VERIFICATION_COMMAND_TIMEOUT and stops", async () => {
    const fs = contractFs();
    const runner = new FakeCommandRunner({ statusById: { install: "timed-out" } });
    const outcome = await runVerify(fs, runner, { json: true, execute: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as { diagnostics: { code: string }[] };
    expect(parsed.diagnostics[0]?.code).toBe("VERIFICATION_COMMAND_TIMEOUT");
  });

  it("reports VERIFICATION_COMMAND_SPAWN_FAILED with exit code 2", async () => {
    const fs = contractFs();
    const runner = new FakeCommandRunner({ statusById: { install: "spawn-failed" } });
    const outcome = await runVerify(fs, runner, { json: true, execute: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.CONTRACT_NOT_FOUND);
    const parsed = JSON.parse(outcome.stdout) as { diagnostics: { code: string }[] };
    expect(parsed.diagnostics[0]?.code).toBe("VERIFICATION_COMMAND_SPAWN_FAILED");
  });

  it("warns with VERIFICATION_NOT_DECLARED and succeeds when there is no verification block", async () => {
    const fs = contractFs({ noVerification: true });
    const runner = new FakeCommandRunner();
    const outcome = await runVerify(fs, runner, { json: true, execute: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(runner.calls).toHaveLength(0);
    const parsed = JSON.parse(outcome.stdout) as { ok: boolean; diagnostics: { code: string }[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics[0]?.code).toBe("VERIFICATION_NOT_DECLARED");
  });

  it("propagates contract validation failures without touching the CommandRunner", async () => {
    const fs = new InMemoryFileSystem("/repo");
    fs.addFile(
      "/repo/agent-ready.yaml",
      "version: 1\nproject:\n  name: example\nnotAField: true\n",
    );
    const runner = new FakeCommandRunner();
    const outcome = await runVerify(fs, runner, { json: true, execute: true }, "/repo");
    expect(outcome.exitCode).not.toBe(ExitCode.SUCCESS);
    expect(runner.calls).toHaveLength(0);
  });
});
