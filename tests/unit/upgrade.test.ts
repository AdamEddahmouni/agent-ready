import { describe, expect, it } from "vitest";
import { runUpgrade } from "../../src/cli/commands/upgrade.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { FileSystemError } from "../../src/filesystem/types.js";

const LEGACY_CONTRACT = `# keep this maintainer comment
version: 1
project:
  name: legacy-project
environment:
  runtimes:
    node: ">=18"
  packageManager:
    name: pnpm
    version: "8"
commands:
  test:
    run: vitest --coverage
  build:
    run: tsc
verification:
  required:
    - test
    - build
`;

const MODERN_CONTRACT = `version: 1
project:
  name: modern-project
environment:
  runtimes:
    node: ">=20"
  packageManager:
    name: pnpm
    version: "10"
commands:
  test:
    run: vitest --coverage
  build:
    run: tsc
verification:
  required: [test, build]
paths:
  protected: [".env*"]
  generated: ["dist/**"]
  ignored: ["node_modules/**", "coverage/**"]
instructions:
  sources: [README.md]
`;

function repository(contract = LEGACY_CONTRACT): InMemoryFileSystem {
  const fs = new InMemoryFileSystem("/repo");
  fs.addDirectory("/repo/.git");
  fs.addFile("/repo/agent-ready.yaml", contract);
  fs.addFile("/repo/.gitignore", ".env\nnode_modules/\n");
  fs.addFile("/repo/README.md", "# Legacy project\n");
  return fs;
}

describe("agent-ready upgrade", () => {
  it("dry-runs evidence-backed additions without modifying the contract", async () => {
    const fs = repository();
    const before = await fs.readTextFile("/repo/agent-ready.yaml");
    const outcome = await runUpgrade(fs, { json: false, write: false });

    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("Upgrade (dry-run)");
    expect(outcome.stdout).toContain("/paths/protected");
    expect(outcome.stdout).toContain("/paths/generated");
    expect(outcome.stdout).toContain("/paths/ignored");
    expect(outcome.stdout).toContain("/instructions/sources");
    expect(outcome.stdout).toContain("Dry run only");
    expect(await fs.readTextFile("/repo/agent-ready.yaml")).toBe(before);
  });

  it("writes a valid modernized contract while preserving comments and declarations", async () => {
    const fs = repository();
    const outcome = await runUpgrade(fs, { json: false, write: true });
    const written = await fs.readTextFile("/repo/agent-ready.yaml");

    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("Upgraded agent-ready.yaml successfully");
    expect(written).toContain("# keep this maintainer comment");
    expect(written).toContain('node: ">=18"');
    expect(written).toContain("node_modules/**");
    expect(written).toContain("coverage/**");
    expect(written).toContain("dist/**");
    expect(written).toContain("README.md");

    const validation = await runUpgrade(fs, { json: true, write: false });
    expect(validation.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("reports an already-modern contract without rewriting it", async () => {
    const fs = repository(MODERN_CONTRACT);
    const before = await fs.readTextFile("/repo/agent-ready.yaml");
    const outcome = await runUpgrade(fs, { json: true, write: true });
    const body = JSON.parse(outcome.stdout) as {
      written: boolean;
      changes: unknown[];
      diagnostics: { code: string }[];
    };

    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(body.written).toBe(false);
    expect(body.changes).toEqual([]);
    expect(body.diagnostics.some((item) => item.code === "UPGRADE_NO_CHANGES_NEEDED")).toBe(true);
    expect(await fs.readTextFile("/repo/agent-ready.yaml")).toBe(before);
  });

  it("flags an old Node range for manual review without replacing it", async () => {
    const fs = repository();
    const outcome = await runUpgrade(fs, { json: true, write: true });
    const body = JSON.parse(outcome.stdout) as {
      diagnostics: { code: string; metadata?: Record<string, unknown> }[];
    };
    const warning = body.diagnostics.find((item) => item.code === "UPGRADE_MANUAL_REVIEW_REQUIRED");

    expect(warning?.metadata).toEqual({ current: ">=18", suggested: ">=20" });
    expect(await fs.readTextFile("/repo/agent-ready.yaml")).toContain('node: ">=18"');
  });

  it("never adds a recommendation that conflicts with another path category", async () => {
    const contract = MODERN_CONTRACT.replace(
      'generated: ["dist/**"]',
      'generated: ["dist/**", "node_modules/**"]',
    ).replace('ignored: ["node_modules/**", "coverage/**"]', 'ignored: ["coverage/**"]');
    const fs = repository(contract);
    const outcome = await runUpgrade(fs, { json: true, write: false });
    const body = JSON.parse(outcome.stdout) as { changes: { id: string }[] };

    expect(body.changes.some((change) => change.id === "ignore-node-modules")).toBe(false);
  });

  it("returns structured change and diff data in JSON mode", async () => {
    const fs = repository();
    const outcome = await runUpgrade(fs, { json: true, write: false });
    const body = JSON.parse(outcome.stdout) as Record<string, unknown>;

    expect(body["ok"]).toBe(true);
    expect(body["mode"]).toBe("dry-run");
    expect(body["written"]).toBe(false);
    expect(body["changes"]).toEqual(expect.any(Array));
    expect(body["diff"]).toContain("+++ /repo/agent-ready.yaml (proposed)");
  });

  it("fails before planning when the existing contract is invalid", async () => {
    const fs = repository("version: 1\nproject: {}\n");
    const outcome = await runUpgrade(fs, { json: true, write: false });
    const body = JSON.parse(outcome.stdout) as { diagnostics: { code: string }[] };

    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    expect(body.diagnostics[0]?.code).toBe("CONTRACT_SCHEMA_INVALID");
  });

  it("surfaces write failures without changing the proposed migration", async () => {
    class WriteFailingFileSystem extends InMemoryFileSystem {
      override writeTextFile(absolutePath: string, _content: string): Promise<void> {
        return Promise.reject(new FileSystemError("read only", absolutePath));
      }
    }

    const fs = new WriteFailingFileSystem("/repo");
    fs.addDirectory("/repo/.git");
    fs.addFile("/repo/agent-ready.yaml", LEGACY_CONTRACT);
    fs.addFile("/repo/.gitignore", ".env\n");
    fs.addFile("/repo/README.md", "# Readme\n");
    const outcome = await runUpgrade(fs, { json: true, write: true });
    const body = JSON.parse(outcome.stdout) as { diagnostics: { code: string }[] };

    expect(outcome.exitCode).toBe(ExitCode.INTERNAL_ERROR);
    expect(body.diagnostics.some((item) => item.code === "UPGRADE_WRITE_FAILED")).toBe(true);
  });
});
