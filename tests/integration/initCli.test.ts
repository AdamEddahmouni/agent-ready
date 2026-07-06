import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/commands/init.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";
import { joinPath } from "../../src/filesystem/pathJoin.js";
import { createTestRepo } from "./testRepo.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

async function repo(files: Record<string, string>) {
  const testRepo = await createTestRepo(files);
  cleanups.push(testRepo.cleanup);
  return testRepo;
}

describe("agent-ready init (CLI composition)", () => {
  it("dry run exits 0 and prints detection summary + proposed YAML", async () => {
    const { root } = await repo({
      "package.json": JSON.stringify({
        name: "test-project",
        description: "A test project for init integration.",
        scripts: {
          lint: "eslint .",
          test: "vitest",
          build: "tsc",
        },
      }),
      ".gitignore": "node_modules/\ndist/\n.env\n",
      "README.md": "# Test Project",
    });
    const outcome = await runInit(new NodeFileSystem(), { json: false, write: false }, root);
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("agent-ready init - repoRoot:");
    expect(outcome.stdout).toContain("project name: test-project");
    expect(outcome.stdout).toContain("--- proposed agent-ready.yaml");
    expect(outcome.stdout).toContain("version: 1");
    expect(outcome.stdout).toContain("name: test-project");
    expect(outcome.stdout).toContain("description: A test project for init integration.");
    expect(outcome.stdout).toContain("lint:");
    expect(outcome.stdout).toContain("run: eslint .");
    expect(outcome.stdout).toContain("Validation: would pass");
    expect(outcome.stderr).toBe("");
  });

  it("--write creates agent-ready.yaml with valid content", async () => {
    const { root } = await repo({
      "package.json": JSON.stringify({
        name: "write-test",
        scripts: {
          lint: "eslint .",
          test: "vitest",
        },
      }),
    });
    const outcome = await runInit(new NodeFileSystem(), { json: false, write: true }, root);
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("Wrote agent-ready.yaml");

    // Verify the file was written and is readable.
    const written = await readFile(join(root, "agent-ready.yaml"), "utf8");
    expect(written).toContain("version: 1");
    expect(written).toContain("name: write-test");
    expect(written).toContain("lint:");
    expect(written).toContain("run: eslint .");
  });

  it("--write refuses to overwrite an existing agent-ready.yaml", async () => {
    const { root } = await repo({
      "package.json": JSON.stringify({ name: "existing-project" }),
      "agent-ready.yaml": "version: 1\nproject:\n  name: hand-authored\n",
    });
    const outcome = await runInit(new NodeFileSystem(), { json: false, write: true }, root);
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    expect(outcome.stderr).toContain("already exists");

    // Verify the existing file was not modified.
    const existing = await readFile(join(root, "agent-ready.yaml"), "utf8");
    expect(existing).toContain("name: hand-authored");
  });

  it("dry run also refuses when contract already exists", async () => {
    const { root } = await repo({
      "package.json": JSON.stringify({ name: "existing-project" }),
      "agent-ready.yaml": "version: 1\nproject:\n  name: hand-authored\n",
    });
    const outcome = await runInit(new NodeFileSystem(), { json: false, write: false }, root);
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    expect(outcome.stderr).toContain("already exists");
  });

  it("--json dry run produces expected envelope shape", async () => {
    const { root } = await repo({
      "package.json": JSON.stringify({
        name: "json-test",
        scripts: { lint: "eslint ." },
      }),
    });
    const outcome = await runInit(new NodeFileSystem(), { json: true, write: false }, root);
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const body = JSON.parse(outcome.stdout) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["mode"]).toBe("dry-run");
    expect(typeof body["repoRoot"]).toBe("string");
    expect(body["repoRoot"]).toBe(root);
    expect(body["detection"]).toBeDefined();
    const detection = body["detection"] as Record<string, unknown>;
    expect(detection["projectName"]).toBe("json-test");
    expect(typeof body["contract"]).toBe("string");
    expect(body["validationPassed"]).toBe(true);
    const diags = body["diagnostics"] as unknown[];
    expect(diags).toEqual([]);
  });

  it("--json --write produces expected envelope shape", async () => {
    const { root } = await repo({
      "package.json": JSON.stringify({ name: "json-write-test" }),
    });
    const outcome = await runInit(new NodeFileSystem(), { json: true, write: true }, root);
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const body = JSON.parse(outcome.stdout) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["mode"]).toBe("write");
    expect(body["contractPath"]).toBe(joinPath(root, "agent-ready.yaml"));
    expect(body["detection"]).toBeDefined();
    expect(body["validationPassed"]).toBe(true);

    // Verify file was written.
    const written = await readFile(join(root, "agent-ready.yaml"), "utf8");
    expect(written).toContain("version: 1");
  });

  it("--json contract-exists case returns structured error", async () => {
    const { root } = await repo({
      "package.json": JSON.stringify({ name: "existing-project" }),
      "agent-ready.yaml": "version: 1\nproject:\n  name: hand-authored\n",
    });
    const outcome = await runInit(new NodeFileSystem(), { json: true, write: true }, root);
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const body = JSON.parse(outcome.stdout) as Record<string, unknown>;
    expect(body["ok"]).toBe(false);
    expect(body["mode"]).toBe("write");
    expect(body["contractPath"]).toBe(joinPath(root, "agent-ready.yaml"));
    const diags = body["diagnostics"] as { code: string }[];
    expect(diags[0]?.code).toBe("INIT_CONTRACT_EXISTS");
  });

  it("generates a contract that includes detected .gitignore patterns", async () => {
    const { root } = await repo({
      "package.json": JSON.stringify({ name: "paths-test" }),
      ".gitignore": "node_modules/\ndist/\n.env\n",
    });
    const outcome = await runInit(new NodeFileSystem(), { json: false, write: false }, root);
    expect(outcome.stdout).toContain("protected:");
    expect(outcome.stdout).toContain('".env*"');
    expect(outcome.stdout).toContain("ignored:");
    expect(outcome.stdout).toContain("node_modules/");
    expect(outcome.stdout).toContain("dist/");
  });

  it("handles a repo with no package.json gracefully", async () => {
    const { root } = await repo({
      "README.md": "# My Project",
    });
    const outcome = await runInit(new NodeFileSystem(), { json: false, write: false }, root);
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("version: 1");
    // Should still contain the directory-based project name.
    const dirName = root.split(/[/\\]/).filter(Boolean).pop() ?? "";
    expect(outcome.stdout).toContain(dirName);
  });

  it("handles package.json with engines.node and packageManager", async () => {
    const { root } = await repo({
      "package.json": JSON.stringify({
        name: "full-featured",
        engines: { node: ">=20" },
        packageManager: "pnpm@10.5.0",
      }),
    });
    const outcome = await runInit(new NodeFileSystem(), { json: false, write: false }, root);
    // Should have an environment block.
    expect(outcome.stdout).toContain("environment:");
    expect(outcome.stdout).toContain("node:");
    expect(outcome.stdout).toContain(">=20");
    expect(outcome.stdout).toContain("packageManager:");
    expect(outcome.stdout).toContain("name: pnpm");
    // The version may be quoted in YAML.
    expect(outcome.stdout).toMatch(/version: .*10\.5\.0/);
  });

  it("generated YAML includes detection-summary comments", async () => {
    const { root } = await repo({
      "package.json": JSON.stringify({
        name: "commented-project",
        engines: { node: ">=20" },
        scripts: { lint: "eslint .", test: "vitest" },
      }),
    });
    const outcome = await runInit(new NodeFileSystem(), { json: false, write: false }, root);
    // The YAML output should have comment lines starting with "#".
    const yamlSection = outcome.stdout.substring(outcome.stdout.indexOf("--- proposed"));
    expect(yamlSection).toContain("# Generated by agent-ready init");
    expect(yamlSection).toContain("# Review each section");
  });
});
