#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { NodeFileSystem } from "../filesystem/nodeFileSystem.js";
import { runValidate } from "./commands/validate.js";
import { runInspect } from "./commands/inspect.js";

interface PackageJson {
  readonly version: string;
}

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as PackageJson;

const program = new Command();

program
  .name("agent-ready")
  .description(
    "Validate and inspect a repository's agent-ready.yaml contract.\n" +
      "This CLI never executes repository commands and never modifies the repository.",
  )
  .version(pkg.version);

program
  .command("validate")
  .description("Discover, parse, and validate the agent-ready.yaml contract.")
  .option("--json", "Print results as machine-readable JSON.", false)
  .option("--config <path>", "Explicit path to the contract file.")
  .action(async (opts: { json: boolean; config?: string }) => {
    const fs = new NodeFileSystem();
    const outcome = await runValidate(fs, opts);
    if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
    if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
    process.exitCode = outcome.exitCode;
  });

program
  .command("inspect")
  .description("Print the fully validated and normalized contract.")
  .option("--json", "Print results as machine-readable JSON.", false)
  .option("--config <path>", "Explicit path to the contract file.")
  .action(async (opts: { json: boolean; config?: string }) => {
    const fs = new NodeFileSystem();
    const outcome = await runInspect(fs, opts);
    if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
    if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
    process.exitCode = outcome.exitCode;
  });

await program.parseAsync(process.argv);
