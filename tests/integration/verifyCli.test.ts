import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runVerify, VERIFICATION_RECORD_FILENAME } from "../../src/cli/commands/verify.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import { NodeCommandRunner } from "../../src/verify/nodeCommandRunner.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";
import { createTestRepo } from "./testRepo.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

// `node -e "..."` is the only command guaranteed to behave identically
// across cmd.exe (Windows) and /bin/sh (POSIX) — this project's own CI
// matrix runs both, so shell builtins like `true`/`false`/`exit 1` are
// deliberately avoided here.
function contractWith(commands: Readonly<Record<string, string>>, required?: readonly string[]) {
  const ids = required ?? Object.keys(commands);
  return [
    "version: 1",
    "project:",
    "  name: verify-example",
    "commands:",
    ...Object.entries(commands).flatMap(([id, run]) => [`  ${id}:`, `    run: ${run}`]),
    "verification:",
    "  required:",
    ...ids.map((id) => `    - ${id}`),
    "",
  ].join("\n");
}

describe("agent-ready verify (CLI composition, real process spawning)", () => {
  it("dry run never spawns a process", async () => {
    const { root, cleanup } = await createTestRepo({
      "agent-ready.yaml": contractWith({ ok: 'node -e "process.exit(0)"' }),
    });
    cleanups.push(cleanup);

    const outcome = await runVerify(
      new NodeFileSystem(),
      new NodeCommandRunner(),
      { json: true, execute: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(outcome.stdout) as { mode: string };
    expect(parsed.mode).toBe("dry-run");
  });

  it("executes a passing command and exits 0", async () => {
    const { root, cleanup } = await createTestRepo({
      "agent-ready.yaml": contractWith({ ok: 'node -e "process.exit(0)"' }),
    });
    cleanups.push(cleanup);

    const outcome = await runVerify(
      new NodeFileSystem(),
      new NodeCommandRunner(),
      { json: true, execute: true },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(outcome.stdout) as {
      ok: boolean;
      commands: { id: string; status: string; exitCode: number | null }[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.commands).toEqual([
      expect.objectContaining({ id: "ok", status: "passed", exitCode: 0 }),
    ]);
  });

  it("reports a real non-zero exit code and stops before later commands", async () => {
    const { root, cleanup } = await createTestRepo({
      "agent-ready.yaml": contractWith({
        first: 'node -e "process.exit(0)"',
        second: 'node -e "process.exit(3)"',
        third: 'node -e "process.exit(0)"',
      }),
    });
    cleanups.push(cleanup);

    const outcome = await runVerify(
      new NodeFileSystem(),
      new NodeCommandRunner(),
      { json: true, execute: true },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as {
      commands: { id: string; status: string; exitCode: number | null }[];
      diagnostics: { code: string }[];
    };
    expect(parsed.commands).toEqual([
      expect.objectContaining({ id: "first", status: "passed", exitCode: 0 }),
      expect.objectContaining({ id: "second", status: "failed", exitCode: 3 }),
      expect.objectContaining({ id: "third", status: "skipped" }),
    ]);
    expect(parsed.diagnostics[0]?.code).toBe("VERIFICATION_COMMAND_FAILED");
  });

  it("kills a hanging command once the timeout elapses", async () => {
    const { root, cleanup } = await createTestRepo({
      "agent-ready.yaml": contractWith({ hang: 'node -e "setTimeout(() => {}, 30000)"' }),
    });
    cleanups.push(cleanup);

    const outcome = await runVerify(
      new NodeFileSystem(),
      new NodeCommandRunner(),
      { json: true, execute: true, timeoutSeconds: 1 },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as {
      commands: { status: string }[];
      diagnostics: { code: string }[];
    };
    expect(parsed.commands[0]?.status).toBe("timed-out");
    expect(parsed.diagnostics[0]?.code).toBe("VERIFICATION_COMMAND_TIMEOUT");
  }, 10_000);

  it("--execute --record writes a real evidence file to the repo root", async () => {
    const { root, cleanup } = await createTestRepo({
      "agent-ready.yaml": contractWith({ ok: 'node -e "process.exit(0)"' }),
    });
    cleanups.push(cleanup);

    const outcome = await runVerify(
      new NodeFileSystem(),
      new NodeCommandRunner(),
      { json: true, execute: true, record: true },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(outcome.stdout) as { recordedTo: string };
    expect(parsed.recordedTo).toContain(VERIFICATION_RECORD_FILENAME);

    const evidenceRaw = await readFile(join(root, VERIFICATION_RECORD_FILENAME), "utf8");
    const evidence = JSON.parse(evidenceRaw) as {
      ok: boolean;
      recordedAt: string;
      mode: string;
      commands: { id: string; status: string }[];
    };
    expect(evidence.ok).toBe(true);
    expect(evidence.mode).toBe("execute");
    expect(evidence.commands).toEqual([expect.objectContaining({ id: "ok", status: "passed" })]);
    expect(() => new Date(evidence.recordedAt).toISOString()).not.toThrow();
  });
});
