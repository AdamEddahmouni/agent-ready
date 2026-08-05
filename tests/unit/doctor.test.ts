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
  '    ruby: ">=3.0"',
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
      // The contract deliberately declares a non-Node, non-graduated
      // runtime (`ruby: ">=3.0"`) so the count is 5; that row is `warn`
      // per ADR-0023 (doctor does not probe ruby). Every other row must
      // be `pass`. Graduated-runtime probing (python/rust/go) has its own
      // dedicated tests below (ADR-0038).
      if (c.check === "runtime-other-ruby") {
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
        '    ruby: ">=3.0"',
        '    java: ">=21"',
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
    expect(parsed.checks.find((c) => c.check === "runtime-other-ruby")?.status).toBe("warn");
    expect(parsed.checks.find((c) => c.check === "runtime-other-java")?.status).toBe("warn");
    const unsupported = parsed.diagnostics.filter(
      (d) => d.code === "RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED",
    );
    expect(unsupported).toHaveLength(2);
  });

  // ADR-0038: python/rust/go graduate from the warn-only
  // `runtime-other-<name>` row to a real, pass/fail-checked probe. `rust`
  // maps to the `cargo` binary — there is no `rust` executable.
  describe("graduated runtime probing (ADR-0038)", () => {
    const GRADUATED_CONTRACT = [
      "environment:",
      "  runtimes:",
      '    python: ">=3.10"',
      '    rust: ">=1.90"',
      '    go: ">=1.22"',
      "paths: {}",
      "",
    ].join("\n");

    const HEALTHY_GRADUATED_PROBES = {
      git: { version: "git version 2.43.0", path: "/usr/bin/git" },
      python: { version: "3.13.14", path: "/usr/bin/python" },
      cargo: { version: "1.96.0", path: "/home/u/.cargo/bin/cargo" },
      go: { version: "1.22.0", path: "/usr/local/go/bin/go" },
    };

    it("emits a passing runtime-<name> row per graduated runtime when every probe satisfies", async () => {
      const fs = contractFs(GRADUATED_CONTRACT);
      const git = new FakeGitClient({ isRepo: true });
      const binary = new FakeBinaryClient({ probe: HEALTHY_GRADUATED_PROBES });
      const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      const parsed = JSON.parse(outcome.stdout) as {
        ok: boolean;
        checks: { check: string; status: string; declared?: unknown; detected?: unknown }[];
        diagnostics: { code: string }[];
      };
      expect(parsed.ok).toBe(true);
      for (const name of ["python", "rust", "go"]) {
        const row = parsed.checks.find((c) => c.check === `runtime-${name}`);
        expect(row?.status, `runtime-${name}`).toBe("pass");
        expect(row?.declared).toBeDefined();
        expect(row?.detected).toBeDefined();
      }
      // The warn-only row is gone for these three, and so is its diagnostic.
      expect(parsed.checks.filter((c) => c.check.startsWith("runtime-other-"))).toHaveLength(0);
      expect(parsed.diagnostics).toEqual([]);
    });

    it("probes `cargo` for a declared `rust` runtime, not a `rust` binary", async () => {
      const fs = contractFs(
        ["environment:", "  runtimes:", '    rust: ">=1.90"', "paths: {}", ""].join("\n"),
      );
      const git = new FakeGitClient({ isRepo: true });
      // A `rust` key is deliberately present and satisfying; it must not be
      // consulted, because `rust` is not the probed target.
      const binary = new FakeBinaryClient({
        probe: {
          git: { version: "git version 2.43.0", path: "/usr/bin/git" },
          cargo: { version: "1.96.0", path: "/home/u/.cargo/bin/cargo" },
        },
      });
      const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      const parsed = JSON.parse(outcome.stdout) as {
        checks: { check: string; status: string; detected?: { version?: string } }[];
      };
      const row = parsed.checks.find((c) => c.check === "runtime-rust");
      expect(row?.status).toBe("pass");
      expect(row?.detected?.version).toBe("1.96.0");
    });

    it("emits RUNTIME_PROBE_UNAVAILABLE and fails the row when the binary is not on PATH", async () => {
      const fs = contractFs(GRADUATED_CONTRACT);
      const git = new FakeGitClient({ isRepo: true });
      const binary = new FakeBinaryClient({
        probe: { ...HEALTHY_GRADUATED_PROBES, go: undefined },
      });
      const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
      expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
      const parsed = JSON.parse(outcome.stdout) as {
        ok: boolean;
        checks: { check: string; status: string; detected: unknown }[];
        diagnostics: { code: string; field?: string }[];
      };
      expect(parsed.ok).toBe(false);
      const row = parsed.checks.find((c) => c.check === "runtime-go");
      expect(row?.status).toBe("fail");
      expect(row?.detected).toBeNull();
      const diagnostic = parsed.diagnostics.find((d) => d.code === "RUNTIME_PROBE_UNAVAILABLE");
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.field).toBe("/environment/runtimes/go");
      // The other two graduated runtimes are unaffected.
      expect(parsed.checks.find((c) => c.check === "runtime-python")?.status).toBe("pass");
      expect(parsed.checks.find((c) => c.check === "runtime-rust")?.status).toBe("pass");
    });

    it("emits RUNTIME_PROBE_UNAVAILABLE when the probe throws (BinaryClientError)", async () => {
      const fs = contractFs(GRADUATED_CONTRACT);
      const git = new FakeGitClient({ isRepo: true });
      const binary = new FakeBinaryClient({
        probe: HEALTHY_GRADUATED_PROBES,
        // Only python throws, so this isolates the probe-throw pathway from
        // the git-probe exit-10 override.
        throwOnProbeByTarget: { python: new BinaryClientError("python probe failed") },
      });
      const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
      expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
      const parsed = JSON.parse(outcome.stdout) as {
        checks: { check: string; status: string }[];
        diagnostics: { code: string; detail?: string }[];
      };
      expect(parsed.checks.find((c) => c.check === "runtime-python")?.status).toBe("fail");
      const diagnostic = parsed.diagnostics.find((d) => d.code === "RUNTIME_PROBE_UNAVAILABLE");
      expect(diagnostic?.detail).toContain("python probe failed");
      expect(parsed.diagnostics.some((d) => d.code === "GIT_UNAVAILABLE")).toBe(false);
    });

    it("emits RUNTIME_PROBE_VERSION_MISMATCH when the detected version does not satisfy the range", async () => {
      const fs = contractFs(GRADUATED_CONTRACT);
      const git = new FakeGitClient({ isRepo: true });
      const binary = new FakeBinaryClient({
        probe: {
          ...HEALTHY_GRADUATED_PROBES,
          python: { version: "3.9.18", path: "/usr/bin/python" }, // 3.9 < 3.10
        },
      });
      const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
      expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
      const parsed = JSON.parse(outcome.stdout) as {
        checks: { check: string; status: string; summary?: string }[];
        diagnostics: { code: string; field?: string }[];
      };
      const row = parsed.checks.find((c) => c.check === "runtime-python");
      expect(row?.status).toBe("fail");
      expect(row?.summary).toContain("3.9.18");
      const diagnostic = parsed.diagnostics.find(
        (d) => d.code === "RUNTIME_PROBE_VERSION_MISMATCH",
      );
      expect(diagnostic?.field).toBe("/environment/runtimes/python");
      expect(parsed.diagnostics.some((d) => d.code === "RUNTIME_PROBE_UNAVAILABLE")).toBe(false);
    });

    it("keeps RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED for non-graduated runtimes declared alongside graduated ones", async () => {
      const fs = contractFs(
        [
          "environment:",
          "  runtimes:",
          '    go: ">=1.22"',
          '    ruby: ">=3.0"',
          "paths: {}",
          "",
        ].join("\n"),
      );
      const git = new FakeGitClient({ isRepo: true });
      const binary = new FakeBinaryClient({ probe: HEALTHY_GRADUATED_PROBES });
      const outcome = await runDoctor(fs, git, binary, { json: true }, "/repo");
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      const parsed = JSON.parse(outcome.stdout) as {
        checks: { check: string; status: string }[];
        diagnostics: { code: string }[];
      };
      expect(parsed.checks.find((c) => c.check === "runtime-go")?.status).toBe("pass");
      expect(parsed.checks.find((c) => c.check === "runtime-other-ruby")?.status).toBe("warn");
      const unsupported = parsed.diagnostics.filter(
        (d) => d.code === "RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED",
      );
      expect(unsupported).toHaveLength(1);
    });
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
