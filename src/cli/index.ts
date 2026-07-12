#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { NodeFileSystem } from "../filesystem/nodeFileSystem.js";
import { NodeGitClient } from "../git/nodeGitClient.js";
import { NodeCommandRunner } from "../verify/nodeCommandRunner.js";
import { NodeBinaryClient } from "../binary/nodeBinaryClient.js";
import { runValidate } from "./commands/validate.js";
import { runInspect } from "./commands/inspect.js";
import { runGenerate } from "./commands/generate.js";
import { runCheck } from "./commands/check.js";
import { runVerify, VERIFICATION_RECORD_FILENAME } from "./commands/verify.js";
import { runAnalyze } from "./commands/analyze.js";
import { runSchema } from "./commands/schema.js";
import { runDoctor } from "./commands/doctor.js";
import { runExplain } from "./commands/explain.js";
import { runInit } from "./commands/init.js";
import { runUpgrade } from "./commands/upgrade.js";

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
    "Validate, inspect, generate, check, analyze, schema, doctor, explain,\n" +
      "init, upgrade, verify, and inspect the bundled contract JSON Schema. This CLI never modifies the repository\n" +
      "unless `generate --write`, `init --write`, or `verify --execute` is used.\n" +
      "Never executes repository commands unless `verify --execute` is used.",
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
  .command("analyze")
  .description(
    "Check declared instruction sources for broken repository-relative\n" +
      "Markdown links. Read-only; never executes commands or rewrites documentation.",
  )
  .option("--json", "Print results as machine-readable JSON.", false)
  .option("--config <path>", "Explicit path to the contract file.")
  .action(async (opts: { json: boolean; config?: string }) => {
    const fs = new NodeFileSystem();
    const outcome = await runAnalyze(fs, opts);
    if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
    if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
    process.exitCode = outcome.exitCode;
  });

program
  .command("schema")
  .description(
    "Print the bundled Agent-Ready contract JSON Schema and its version\n" +
      "metadata. Read-only; never modifies the repository, never executes\n" +
      "commands, and does not require an existing agent-ready.yaml.",
  )
  .option("--json", "Print results as machine-readable JSON.", false)
  .option(
    "--content",
    "Include the full parsed schema body in the output, not just metadata.",
    false,
  )
  .action(async (opts: { json: boolean; content: boolean }) => {
    const outcome = await runSchema({ json: opts.json, content: opts.content });
    if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
    if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
    process.exitCode = outcome.exitCode;
  });

program
  .command("doctor")
  .description(
    "Inspect the host environment for fitness to run Agent-Ready against\n" +
      "the contract: declared Node range, declared package manager,\n" +
      "declared non-Node runtimes, Git on PATH, and Git working-tree\n" +
      "membership. Read-only; never executes contract-declared commands,\n" +
      "never invokes Git for state-changing operations, never modifies the\n" +
      "repository. See docs/decisions/0023-agent-ready-doctor-command.md.",
  )
  .option("--json", "Print results as machine-readable JSON.", false)
  .option("--config <path>", "Explicit path to the contract file.")
  .action(async (opts: { json: boolean; config?: string }) => {
    const fs = new NodeFileSystem();
    const git = new NodeGitClient();
    const binary = new NodeBinaryClient();
    const outcome = await runDoctor(fs, git, binary, opts);
    if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
    if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
    process.exitCode = outcome.exitCode;
  });

program
  .command("explain")
  .description(
    "Print an extended, plain-language explanation of a diagnostic code.\n" +
      "Optionally loads a contract via --config for field-specific context.\n" +
      "Read-only; never modifies the repository, never executes commands.\n" +
      "See docs/decisions/0024-agent-ready-explain-command.md.",
  )
  .requiredOption(
    "--code <CODE>",
    "The diagnostic code to explain (e.g. PACKAGE_MANAGER_UNAVAILABLE).",
  )
  .option("--json", "Print results as machine-readable JSON.", false)
  .option("--config <path>", "Explicit path to the contract file for field-specific context.")
  .action(async (opts: { json: boolean; code: string; config?: string }) => {
    const fs = new NodeFileSystem();
    const outcome = await runExplain(fs, opts);
    if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
    if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
    process.exitCode = outcome.exitCode;
  });

program
  .command("init")
  .description(
    "Scaffold a starter agent-ready.yaml from repository inspection.\n" +
      "Defaults to a dry run (prints the generated contract to stdout);\n" +
      "nothing is written unless --write is passed. Never overwrites an\n" +
      "existing contract file. See ADR-0025.",
  )
  .option("--write", "Write agent-ready.yaml to the repository root.", false)
  .option("--json", "Print results as machine-readable JSON.", false)
  .action(async (opts: { write: boolean; json: boolean }) => {
    const fs = new NodeFileSystem();
    const outcome = await runInit(fs, opts);
    if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
    if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
    process.exitCode = outcome.exitCode;
  });

program
  .command("upgrade")
  .description(
    "Inspect an existing agent-ready.yaml and propose safe, additive\n" +
      "modernizations. Defaults to a dry run with a field-level diff;\n" +
      "nothing is written unless --write is passed.",
  )
  .option("--write", "Apply the proposed safe transformations in place.", false)
  .option("--json", "Print results as machine-readable JSON.", false)
  .option("--config <path>", "Explicit path to the contract file.")
  .action(async (opts: { write: boolean; json: boolean; config?: string }) => {
    const fs = new NodeFileSystem();
    const outcome = await runUpgrade(fs, opts);
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
  .option(
    "--record",
    `With --execute, write a JSON evidence file (${VERIFICATION_RECORD_FILENAME}) to the repo root.`,
    false,
  )
  .option(
    "--handoff <path>",
    "Validate structured handoff JSON and include it in recorded evidence.",
  )
  .option(
    "--check-generate",
    "Check generated instruction files before running any verification command.",
    false,
  )
  .option("--json", "Print results as machine-readable JSON.", false)
  .option("--config <path>", "Explicit path to the contract file.")
  .action(
    async (opts: {
      execute: boolean;
      timeout?: number;
      record: boolean;
      json: boolean;
      config?: string;
      handoff?: string;
      checkGenerate: boolean;
    }) => {
      const fs = new NodeFileSystem();
      const commandRunner = new NodeCommandRunner();
      const outcome = await runVerify(fs, commandRunner, {
        json: opts.json,
        execute: opts.execute,
        record: opts.record,
        ...(opts.config !== undefined && { config: opts.config }),
        ...(opts.timeout !== undefined && { timeoutSeconds: opts.timeout }),
        ...(opts.handoff !== undefined && { handoffPath: opts.handoff }),
        checkGenerate: opts.checkGenerate,
      });
      if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
      if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
      process.exitCode = outcome.exitCode;
    },
  );

await program.parseAsync(process.argv);
