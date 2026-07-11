import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runUpgrade } from "../../src/cli/commands/upgrade.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import { createTestRepo } from "./testRepo.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const CONTRACT = `version: 1
project:
  name: integration-upgrade
environment:
  packageManager:
    name: pnpm
    version: "10"
commands:
  build:
    run: tsc
`;

describe("agent-ready upgrade (CLI composition)", () => {
  it("discovers, previews, and writes a real contract", async () => {
    const repo = await createTestRepo({
      "agent-ready.yaml": CONTRACT,
      ".gitignore": ".env\n",
      "README.md": "# Integration upgrade\n",
    });
    cleanups.push(repo.cleanup);

    const dryRun = await runUpgrade(new NodeFileSystem(), { json: true, write: false }, repo.root);
    expect(dryRun.exitCode).toBe(ExitCode.SUCCESS);
    expect(JSON.parse(dryRun.stdout)).toMatchObject({ mode: "dry-run", written: false });

    const write = await runUpgrade(new NodeFileSystem(), { json: true, write: true }, repo.root);
    expect(write.exitCode).toBe(ExitCode.SUCCESS);
    expect(JSON.parse(write.stdout)).toMatchObject({ mode: "write", written: true });

    const contract = await readFile(join(repo.root, "agent-ready.yaml"), "utf8");
    expect(contract).toContain("node_modules/**");
    expect(contract).toContain("dist/**");
    expect(contract).toContain(".env*");
    expect(contract).toContain("README.md");
  });

  it("supports an explicit --config path", async () => {
    const repo = await createTestRepo({ "config/custom.yaml": CONTRACT });
    cleanups.push(repo.cleanup);
    const configPath = join(repo.root, "config", "custom.yaml");

    const outcome = await runUpgrade(new NodeFileSystem(), {
      json: true,
      write: false,
      config: configPath,
    });
    const body = JSON.parse(outcome.stdout) as { contractPath: string };

    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(body.contractPath).toBe(configPath);
  });
});
