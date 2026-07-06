import { describe, expect, it } from "vitest";
import { runDoctor } from "../../src/cli/commands/doctor.js";
import { FakeBinaryClient } from "../../src/binary/fakeBinaryClient.js";
import { BinaryClientError } from "../../src/binary/types.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { FakeGitClient } from "../../src/git/fakeGitClient.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";

function contractFs(yamlBody: string, repoRoot = "/repo"): InMemoryFileSystem {
  const fs = new InMemoryFileSystem(repoRoot);
  fs.addFile(
    `${repoRoot}/agent-ready.yaml`,
    `version: 1\nproject:\n  name: doctor-example\n${yamlBody}`,
  );
  return fs;
}

const ALL_PASS_CONTRACT = [
  "environment:",
  "  runtimes:",
  '    node: ">=20"',
  '    python: ">=3.10"',
  "  packageManager:",
  "    name: pnpm",
  '    version: "10"',
  "paths:",
  "  protected:",
  '    - ".env*"',
  "",
].join("\n");

describe("runDoctor", () => {
  it("reports pass across all 5 axes on a healthy environment", async () => {
    const fs = contractFs(ALL_PASS_CONTRACT);
    const git = new FakeGitClient({ isRepo: true });
    const binary = new FakeBinaryClient({
      probe: {
        git: { version: "git version 2.43.0", path: "/usr/bin/git" },
        pnpm: { version: "10.5.0", path: "/usr/local/bin/pnpm" },
      },
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(outcome.stdout) as {
      ok: boolean;
      checks: { check: string; status: string }[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.checks).toHaveLength(5);
    for (const c of parsed.checks) {
      // The contract deliberately declares a non-Node runtime (`python: ">=3.10"`)
      // so the count is 5; that row is `warn` per ADR-0023 (doctor does not
      // probe python in this ADR). Every other row must be `pass`.
      if (c.check === "runtime-other-python") {
        expect(c.status).toBe("warn");
      } else {
        expect(c.status).toBe("pass");
      }
    }
  });

  it("emits RUNTIME_VERSION_MISMATCH when process.version does not satisfy declared range", async () => {
    const fs = contractFs(
      [
        "environment:",
        "  runtimes:",
        '    node: ">=100 <101"',
        "paths:",
        "  protected:",
        '    - ".env*"',
        "",
      ].join("\n"),
    );
    const git = new FakeGitClient({ isRepo: true });
    const binary = new FakeBinaryClient({
      probe: { git: { version: "git version 2.43.0", path: "/usr/bin/git" } },
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as {
      ok: boolean;
      checks: { check: string; status: string }[];
      diagnostics: { code: string }[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.checks.find((c) => c.check === "runtime-node")?.status).toBe("fail");
    expect(parsed.diagnostics.some((d) => d.code === "RUNTIME_VERSION_MISMATCH")).toBe(true);
  });

  it("warns on runtime-node (no diagnostic emitted) when node is not declared in environment.runtimes", async () => {
    const fs = contractFs(["paths:", "  protected:", '    - ".env*"', ""].join("\n"));
    const git = new FakeGitClient({ isRepo: true });
    const binary = new FakeBinaryClient({
      probe: { git: { version: "git version 2.43.0", path: "/usr/bin/git" } },
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(outcome.stdout) as {
      ok: boolean;
      checks: { check: string; status: string; declared?: unknown }[];
      diagnostics: { code: string }[];
    };
    expect(parsed.ok).toBe(true);
    const runtimeNode = parsed.checks.find((c) => c.check === "runtime-node");
    expect(runtimeNode?.status).toBe("warn");
    expect(runtimeNode?.declared).toBeUndefined();
    expect(parsed.diagnostics.some((d) => d.code === "RUNTIME_VERSION_MISMATCH")).toBe(false);
  });

  it("emits one runtime-other-<name> row per declared non-node runtime, with RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED", async () => {
    const fs = contractFs(
      [
        "environment:",
        "  runtimes:",
        '    python: ">=3.10"',
        '    ruby: ">=3.0"',
        "paths:",
        "  protected:",
        '    - ".env*"',
        "",
      ].join("\n"),
    );
    const git = new FakeGitClient({ isRepo: true });
    const binary = new FakeBinaryClient({
      probe: { git: { version: "git version 2.43.0", path: "/usr/bin/git" } },
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(outcome.stdout) as {
      checks: { check: string; status: string }[];
      diagnostics: { code: string }[];
    };
    expect(parsed.checks.filter((c) => c.check.startsWith("runtime-other-"))).toHaveLength(2);
    expect(parsed.checks.find((c) => c.check === "runtime-other-python")?.status).toBe("warn");
    expect(parsed.checks.find((c) => c.check === "runtime-other-ruby")?.status).toBe("warn");
    const unsupported = parsed.diagnostics.filter(
      (d) => d.code === "RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED",
    );
    expect(unsupported).toHaveLength(2);
  });

  it("emits PACKAGE_MANAGER_UNAVAILABLE when package-manager probe returns undefined", async () => {
    const fs = contractFs(ALL_PASS_CONTRACT);
    const git = new FakeGitClient({ isRepo: true });
    const binary = new FakeBinaryClient({
      probe: { git: { version: "git version 2.43.0", path: "/usr/bin/git" } },
      // pnpm omitted = unavailable.
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as {
      diagnostics: { code: string }[];
    };
    expect(parsed.diagnostics.some((d) => d.code === "PACKAGE_MANAGER_UNAVAILABLE")).toBe(true);
  });

  it("emits PACKAGE_MANAGER_UNAVAILABLE when the package-manager probe throws (BinaryClientError)", async () => {
    const fs = contractFs(ALL_PASS_CONTRACT);
    const git = new FakeGitClient({ isRepo: true });
    const binary = new FakeBinaryClient({
      probe: {
        git: { version: "git version 2.43.0", path: "/usr/bin/git" },
        // pnpm probe throws; git stays healthy so this test isolates the
        // package-manager probe-throw pathway from the GIT_UNAVAILABLE
        // exit-10 override.
      },
      throwOnProbeByTarget: {
        pnpm: new BinaryClientError("pnpm probe failed"),
      },
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as {
      diagnostics: { code: string }[];
    };
    expect(parsed.diagnostics.some((d) => d.code === "PACKAGE_MANAGER_UNAVAILABLE")).toBe(true);
    expect(parsed.diagnostics.some((d) => d.code === "GIT_UNAVAILABLE")).toBe(false);
  });

  it("emits PACKAGE_MANAGER_VERSION_MISMATCH when detected version does not satisfy declared", async () => {
    const fs = contractFs(ALL_PASS_CONTRACT);
    const git = new FakeGitClient({ isRepo: true });
    const binary = new FakeBinaryClient({
      probe: {
        git: { version: "git version 2.43.0", path: "/usr/bin/git" },
        pnpm: { version: "9.0.0", path: "/usr/local/bin/pnpm" }, // 9 != 10
      },
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as {
      diagnostics: { code: string }[];
    };
    expect(parsed.diagnostics.some((d) => d.code === "PACKAGE_MANAGER_VERSION_MISMATCH")).toBe(
      true,
    );
  });

  it("emits GIT_REQUIRED_BUT_UNAVAILABLE when git is missing and paths.protected is non-empty", async () => {
    const fs = contractFs(
      [
        "environment:",
        "  runtimes:",
        '    node: ">=20"',
        "paths:",
        "  protected:",
        '    - ".env*"',
        "",
      ].join("\n"),
    );
    const git = new FakeGitClient({ isRepo: true });
    const binary = new FakeBinaryClient({
      probe: {}, // git unavailable; pnpm not declared
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as {
      diagnostics: { code: string }[];
    };
    expect(parsed.diagnostics.some((d) => d.code === "GIT_REQUIRED_BUT_UNAVAILABLE")).toBe(true);
  });

  it("warns (no error) on git-on-path when git is missing and paths.protected is empty", async () => {
    const fs = contractFs(
      ["environment:", "  runtimes:", '    node: ">=20"', "paths: {}", ""].join("\n"),
    );
    const git = new FakeGitClient({ isRepo: false });
    const binary = new FakeBinaryClient({
      probe: {}, // git unavailable
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(outcome.stdout) as {
      ok: boolean;
      diagnostics: { code: string }[];
      checks: { check: string; status: string }[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.checks.find((c) => c.check === "git-on-path")?.status).toBe("warn");
  });

  it("warns on git-repository when git is on PATH but cwd is not a Git working tree (with paths.protected empty)", async () => {
    const fs = contractFs(
      ["environment:", "  runtimes:", '    node: ">=20"', "paths: {}", ""].join("\n"),
    );
    const git = new FakeGitClient({ isRepo: false });
    const binary = new FakeBinaryClient({
      probe: { git: { version: "git version 2.43.0", path: "/usr/bin/git" } },
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(outcome.stdout) as {
      checks: { check: string; status: string }[];
    };
    expect(parsed.checks.find((c) => c.check === "git-repository")?.status).toBe("warn");
  });

  it("emits GIT_UNAVAILABLE and exits 10 when git probe throws", async () => {
    const fs = contractFs(
      [
        "environment:",
        "  runtimes:",
        '    node: ">=20"',
        "paths:",
        "  protected:",
        '    - ".env*"',
        "",
      ].join("\n"),
    );
    const git = new FakeGitClient({ isRepo: true });
    const binary = new FakeBinaryClient({
      throwOnProbe: new BinaryClientError("git execFile failed"),
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.INTERNAL_ERROR);
    const parsed = JSON.parse(outcome.stdout) as {
      diagnostics: { code: string }[];
    };
    expect(parsed.diagnostics.some((d) => d.code === "GIT_UNAVAILABLE")).toBe(true);
  });

  it("JSON envelope contains exactly { ok, contractPath, repoRoot, checks, diagnostics }", async () => {
    const fs = contractFs(ALL_PASS_CONTRACT);
    const git = new FakeGitClient({ isRepo: true });
    const binary = new FakeBinaryClient({
      probe: {
        git: { version: "git version 2.43.0", path: "/usr/bin/git" },
        pnpm: { version: "10.5.0", path: "/usr/local/bin/pnpm" },
      },
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    const parsed = JSON.parse(outcome.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "checks",
      "contractPath",
      "diagnostics",
      "ok",
      "repoRoot",
    ]);
  });

  it("every check row carries at least `check` and `status`; conditional fields per ADR-0023", async () => {
    const fs = contractFs(ALL_PASS_CONTRACT);
    const git = new FakeGitClient({ isRepo: true });
    const binary = new FakeBinaryClient({
      probe: {
        git: { version: "git version 2.43.0", path: "/usr/bin/git" },
        pnpm: { version: "10.5.0", path: "/usr/local/bin/pnpm" },
      },
    });
    const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
    const parsed = JSON.parse(outcome.stdout) as {
      checks: {
        check: string;
        status: string;
        declared?: unknown;
        detected?: unknown;
        required?: unknown;
        summary?: unknown;
      }[];
    };
    for (const row of parsed.checks) {
      expect(typeof row.check).toBe("string");
      expect(["pass", "warn", "fail"]).toContain(row.status);
    }
    const runtimeNode = parsed.checks.find((c) => c.check === "runtime-node");
    expect(runtimeNode?.declared).toBeDefined();
    expect(runtimeNode?.detected).toBeDefined();
    const gitRepo = parsed.checks.find((c) => c.check === "git-repository");
    expect(gitRepo).toBeDefined();
    if (gitRepo !== undefined) {
      expect(typeof gitRepo.detected).toBe("boolean");
      expect(typeof gitRepo.required).toBe("boolean");
    }
  });
});
