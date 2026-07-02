#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { NodeFileSystem } from "../filesystem/nodeFileSystem.js";
import { NodeGitClient } from "../git/nodeGitClient.js";
import { NodeCommandRunner } from "../verify/nodeCommandRunner.js";
import { runValidate } from "./commands/validate.js";
import { runInspect } from "./commands/inspect.js";
import { runGenerate } from "./commands/generate.js";
import { runCheck } from "./commands/check.js";
import { runVerify } from "./commands/verify.js";

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
      "agent-ready.yaml contract. This CLI never modifies the repository unless\n" +
      "`generate --write` is used, and never executes repository commands\n" +
      "unless `verify --execute` is used.",
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

program
  .command("check")
  .description(
    "Check whether any file matching the contract's paths.protected was\n" +
      "changed in Git. Requires a Git working tree and the `git` executable\n" +
      "on PATH; git is only ever invoked with Agent-Ready-hardcoded arguments.",
  )
  .option("--json", "Print results as machine-readable JSON.", false)
  .option("--config <path>", "Explicit path to the contract file.")
  .option("--staged", "Check staged changes instead of the full working tree.", false)
  .option("--against <ref>", "Check changes relative to an explicit Git ref instead of HEAD.")
  .action(async (opts: { json: boolean; config?: string; staged: boolean; against?: string }) => {
    const fs = new NodeFileSystem();
    const git = new NodeGitClient();
    const outcome = await runCheck(fs, git, opts);
    if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
    if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
    process.exitCode = outcome.exitCode;
  });

program
  .command("verify")
  .description(
    "Run the contract's verification.required commands, in declared order.\n" +
      "Defaults to a dry run (prints the plan, executes nothing); pass\n" +
      "--execute to actually run the commands. This is the only Agent-Ready\n" +
      "command that executes contract-declared `run` strings (see ADR-0014).",
  )
  .option(
    "--execute",
    "Actually run the commands. Without this, verify only prints the plan.",
    false,
  )
  .option(
    "--timeout <seconds>",
    "Per-command timeout in seconds (default: 900).",
    (value: string) => Number.parseInt(value, 10),
  )
  .option("--json", "Print results as machine-readable JSON.", false)
  .option("--config <path>", "Explicit path to the contract file.")
  .action(async (opts: { execute: boolean; timeout?: number; json: boolean; config?: string }) => {
    const fs = new NodeFileSystem();
    const commandRunner = new NodeCommandRunner();
    const outcome = await runVerify(fs, commandRunner, {
      json: opts.json,
      execute: opts.execute,
      ...(opts.config !== undefined && { config: opts.config }),
      ...(opts.timeout !== undefined && { timeoutSeconds: opts.timeout }),
    });
    if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
    if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
    process.exitCode = outcome.exitCode;
  });

await program.parseAsync(process.argv);
