#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { NodeFileSystem } from "../filesystem/nodeFileSystem.js";
import { runValidate } from "./commands/validate.js";
import { runInspect } from "./commands/inspect.js";
import { runGenerate } from "./commands/generate.js";

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
    "Validate, inspect, and generate agent instructions from a repository's\n" +
      "agent-ready.yaml contract. This CLI never executes repository commands,\n" +
      "and never modifies the repository unless `generate --write` is used.",
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

program
  .command("generate")
  .description(
    "Generate AGENTS.md/CLAUDE.md from the agent-ready.yaml contract's\n" +
      "enabled adapters. Defaults to a dry run; nothing is written unless\n" +
      "--write is passed.",
  )
  .option("--write", "Write planned files to disk.", false)
  .option(
    "--check",
    "Exit non-zero if generated output would differ from what's on disk. Never writes.",
    false,
  )
  .option(
    "--force",
    "With --write, overwrite existing files that lack the managed-file marker.",
    false,
  )
  .option("--json", "Print results as machine-readable JSON.", false)
  .option("--config <path>", "Explicit path to the contract file.")
  .action(
    async (opts: {
      write: boolean;
      check: boolean;
      force: boolean;
      json: boolean;
      config?: string;
    }) => {
      const fs = new NodeFileSystem();
      const outcome = await runGenerate(fs, opts);
      if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
      if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
      process.exitCode = outcome.exitCode;
    },
  );

await program.parseAsync(process.argv);
