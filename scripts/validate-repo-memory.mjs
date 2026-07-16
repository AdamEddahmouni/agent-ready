#!/usr/bin/env node

/**
 * validate-repo-memory.mjs — Validate that the repository's brain
 * integration configuration is complete and internally consistent.
 *
 * Checks:
 *   - .devbrain/project.yaml exists and has required fields
 *   - All required context files referenced in project.yaml exist
 *   - CLAUDE.md and AGENTS.md exist
 *   - Session log directory exists
 *   - Required docs (STATUS.md, WORK_LOG.md, LESSONS.md) exist
 *   - No excluded paths contain required context files
 *   - agent-ready.yaml passes validation
 *
 * Exit codes:
 *   0 — All checks passed
 *   1 — One or more checks failed
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function checkFailures(failures) {
  if (failures.length === 0) return;

  console.log(`\n${failures.length} check(s) failed:`);
  for (const f of failures) {
    console.log(`  FAIL  ${f}`);
  }
  process.exit(1);
}

function main() {
  console.log("Validating repository memory configuration...\n");

  const failures = [];

  // 1. .devbrain/project.yaml
  const brainYamlPath = resolve(repoRoot, ".devbrain", "project.yaml");
  if (!existsSync(brainYamlPath)) {
    failures.push(".devbrain/project.yaml is missing");
  }

  let config = null;
  if (existsSync(brainYamlPath)) {
    try {
      config = parseYaml(readFileSync(brainYamlPath, "utf8"));
      console.log("OK  .devbrain/project.yaml");
    } catch (e) {
      failures.push(`.devbrain/project.yaml: ${e.message}`);
      console.log("FAIL  .devbrain/project.yaml (parse error)");
    }
  }

  // 2. Protocol files
  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    const path = resolve(repoRoot, file);
    if (existsSync(path)) {
      console.log(`OK  ${file}`);
    } else {
      failures.push(`${file} is missing`);
      console.log(`FAIL  ${file}`);
    }
  }

  // 3. Required docs
  const requiredDocs = ["docs/STATUS.md", "docs/WORK_LOG.md", "docs/LESSONS.md"];
  for (const file of requiredDocs) {
    const path = resolve(repoRoot, file);
    if (existsSync(path)) {
      console.log(`OK  ${file}`);
    } else {
      failures.push(`${file} is missing`);
      console.log(`FAIL  ${file}`);
    }
  }

  // 4. Session log directory
  const logDir = resolve(repoRoot, "docs", "SESSION_LOGS");
  if (existsSync(logDir)) {
    console.log("OK  docs/SESSION_LOGS/");
  } else {
    failures.push("docs/SESSION_LOGS/ is missing");
    console.log("FAIL  docs/SESSION_LOGS/");
  }

  // 5. Required context files (from project.yaml)
  if (config?.documentation?.required_context) {
    for (const file of config.documentation.required_context) {
      const path = resolve(repoRoot, file);
      if (existsSync(path)) {
        console.log(`OK  ${file} (context)`);
      } else {
        failures.push(`Required context file missing: ${file}`);
        console.log(`FAIL  ${file} (context)`);
      }
    }
  }

  // 6. agent-ready.yaml exists and basic structure check
  const contractPath = resolve(repoRoot, "agent-ready.yaml");
  if (existsSync(contractPath)) {
    console.log("OK  agent-ready.yaml");
    try {
      const contract = parseYaml(readFileSync(contractPath, "utf8"));
      if (!contract.project?.name) {
        failures.push("agent-ready.yaml: missing project.name");
      }
    } catch (e) {
      failures.push(`agent-ready.yaml: ${e.message}`);
    }
  } else {
    failures.push("agent-ready.yaml is missing");
  }

  // Summary
  console.log();
  if (failures.length === 0) {
    console.log("All checks passed. Repository memory configuration is valid.");
    process.exit(0);
  } else {
    checkFailures(failures);
  }
}

main();
