#!/usr/bin/env node

/**
 * register-project.mjs — Register this project with the Agentic Development Brain.
 *
 * Reads .devbrain/project.yaml, validates required fields, and prints a
 * registration summary. No network calls, no external services.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const REQUIRED_TOP_FIELDS = ["project", "brain", "graph", "documentation", "excluded", "session"];

const REQUIRED_PROJECT_FIELDS = ["key", "display_name"];

function readProjectYaml() {
  const path = resolve(repoRoot, ".devbrain", "project.yaml");
  if (!existsSync(path)) {
    console.error("ERROR: .devbrain/project.yaml not found. Create it first.");
    process.exit(1);
  }
  const raw = readFileSync(path, "utf8");
  return parseYaml(raw);
}

function validateConfig(config) {
  const errors = [];

  for (const field of REQUIRED_TOP_FIELDS) {
    if (!(field in config)) {
      errors.push(`Missing top-level field: ${field}`);
    }
  }

  if (config.project) {
    for (const field of REQUIRED_PROJECT_FIELDS) {
      if (!(field in config.project)) {
        errors.push(`Missing project field: ${field}`);
      }
    }
  }

  return errors;
}

function main() {
  console.log("Registering project with Agentic Development Brain...\n");

  const config = readProjectYaml();
  const errors = validateConfig(config);

  if (errors.length > 0) {
    console.error("Validation errors:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  const project = config.project;
  console.log(`  Project Key:       ${project.key}`);
  console.log(`  Display Name:      ${project.display_name}`);
  console.log(`  Description:       ${project.description || "(none)"}`);
  console.log(`  Version:           ${project.version || "(none)"}`);
  console.log(`  Registration ID:   ${config.brain.registration?.registration_id || "N/A"}`);
  console.log(`  Graph Provider:    ${config.graph.provider}`);
  console.log(`  Protocol Files:    ${config.session.protocol_files.join(", ")}`);
  console.log(`  Log Directory:     ${config.session.log_directory}`);
  console.log();

  // Check that required context files exist
  console.log("Checking required context files...");
  let allFound = true;
  for (const file of config.documentation.required_context) {
    const path = resolve(repoRoot, file);
    const found = existsSync(path);
    console.log(`  ${found ? "OK" : "MISSING"}  ${file}`);
    if (!found) allFound = false;
  }

  console.log();
  if (allFound) {
    console.log("Registration complete. Project is ready for brain integration.");
  } else {
    console.error(
      "WARNING: Some required context files are missing. Run validate-repo-memory for details.",
    );
  }
}

main();
