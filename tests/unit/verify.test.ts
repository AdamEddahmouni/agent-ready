import { describe, expect, it } from "vitest";
import { runVerify, VERIFICATION_RECORD_FILENAME } from "../../src/cli/commands/verify.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { FileSystemError } from "../../src/filesystem/types.js";
import { FakeCommandRunner } from "../../src/verify/fakeCommandRunner.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";

class WriteFailingFileSystem extends InMemoryFileSystem {
  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  override async writeTextFile(absolutePath: string): Promise<void> {
    throw new FileSystemError("Simulated write failure.", absolutePath);
  }
}

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

  it("reports VERIFICATION_COMMAND_TERMINATION_FAILED and stops", async () => {
    const fs = contractFs();
    const runner = new FakeCommandRunner({ statusById: { install: "termination-failed" } });
    const outcome = await runVerify(fs, runner, { json: true, execute: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    expect(outcome.stdout).toContain("VERIFICATION_COMMAND_TERMINATION_FAILED");
  });

  it.each([0, -1, 1.5, 3601, Number.NaN])(
    "rejects unsafe CLI timeout %s",
    async (timeoutSeconds) => {
      const outcome = await runVerify(
        contractFs(),
        new FakeCommandRunner(),
        { json: true, execute: true, timeoutSeconds },
        "/repo",
      );
      expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
      expect(outcome.stdout).toContain("--timeout must be an integer from 1 through 3600");
    },
  );

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

  describe("--record", () => {
    it("rejects --record without --execute and writes nothing", async () => {
      const fs = contractFs();
      const runner = new FakeCommandRunner();
      const outcome = await runVerify(
        fs,
        runner,
        { json: true, execute: false, record: true },
        "/repo",
      );
      expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
      expect(runner.calls).toHaveLength(0);
      expect(await fs.stat(`/repo/${VERIFICATION_RECORD_FILENAME}`)).toBeUndefined();
    });

    it("writes an evidence file with a deterministic recordedAt when all commands pass", async () => {
      const fs = contractFs();
      const runner = new FakeCommandRunner();
      const now = () => new Date("2026-01-01T00:00:00.000Z");
      const outcome = await runVerify(
        fs,
        runner,
        { json: true, execute: true, record: true },
        "/repo",
        now,
      );
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      const parsed = JSON.parse(outcome.stdout) as { recordedTo: string };
      expect(parsed.recordedTo).toBe(`/repo/${VERIFICATION_RECORD_FILENAME}`);

      const written = JSON.parse(
        await fs.readTextFile(`/repo/${VERIFICATION_RECORD_FILENAME}`),
      ) as {
        ok: boolean;
        recordedAt: string;
        mode: string;
        commands: { id: string; status: string }[];
      };
      expect(written.ok).toBe(true);
      expect(written.recordedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(written.mode).toBe("execute");
      expect(written.commands.map((c) => c.status)).toEqual(["passed", "passed"]);
    });

    it("still writes the evidence file (with failed/skipped statuses) when a command fails", async () => {
      const fs = contractFs({
        commands: { install: "pnpm install", lint: "pnpm lint", test: "pnpm test" },
      });
      const runner = new FakeCommandRunner({ statusById: { lint: "failed" } });
      const outcome = await runVerify(
        fs,
        runner,
        { json: true, execute: true, record: true },
        "/repo",
      );
      expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
      const written = JSON.parse(
        await fs.readTextFile(`/repo/${VERIFICATION_RECORD_FILENAME}`),
      ) as { ok: boolean; commands: { status: string }[] };
      expect(written.ok).toBe(false);
      expect(written.commands.map((c) => c.status)).toEqual(["passed", "failed", "skipped"]);
    });

    it("writes an evidence file with an empty commands array when nothing is declared", async () => {
      const fs = contractFs({ noVerification: true });
      const runner = new FakeCommandRunner();
      const outcome = await runVerify(
        fs,
        runner,
        { json: true, execute: true, record: true },
        "/repo",
      );
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      const written = JSON.parse(
        await fs.readTextFile(`/repo/${VERIFICATION_RECORD_FILENAME}`),
      ) as { commands: unknown[]; diagnostics: { code: string }[] };
      expect(written.commands).toEqual([]);
      expect(written.diagnostics[0]?.code).toBe("VERIFICATION_NOT_DECLARED");
    });

    it("reports VERIFICATION_RECORD_WRITE_FAILED when the evidence file can't be written", async () => {
      const fs = new WriteFailingFileSystem("/repo");
      fs.addFile(
        "/repo/agent-ready.yaml",
        "version: 1\nproject:\n  name: example\ncommands:\n  install:\n    run: pnpm install\nverification:\n  required:\n    - install\n",
      );
      const runner = new FakeCommandRunner();
      const outcome = await runVerify(
        fs,
        runner,
        { json: true, execute: true, record: true },
        "/repo",
      );
      expect(outcome.exitCode).toBe(ExitCode.INTERNAL_ERROR);
      const parsed = JSON.parse(outcome.stdout) as { ok: boolean; diagnostics: { code: string }[] };
      expect(parsed.ok).toBe(false);
      expect(parsed.diagnostics.map((d) => d.code)).toContain("VERIFICATION_RECORD_WRITE_FAILED");
    });
  });
});
