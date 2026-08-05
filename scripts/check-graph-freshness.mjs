#!/usr/bin/env node

/**
 * check-graph-freshness.mjs — Check whether the structural graph is current.
 *
 * Reads .devbrain/project.yaml for the graph.output_path and
 * graph.freshness_max_age_hours. Checks whether the graph metadata file
 * exists and is within the freshness window.
 *
 * Exit codes:
 *   0 — Graph is fresh
 *   1 — Graph is stale (needs refresh)
 *   2 — Graph is missing (never generated)
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function readConfig() {
  const path = resolve(repoRoot, ".devbrain", "project.yaml");
  if (!existsSync(path)) {
    return null;
  }
  return parseYaml(readFileSync(path, "utf8"));
}

function main() {
  const config = readConfig();
  const outputPath = config?.graph?.output_path || "docs/graph/";
  const maxAgeHours = config?.graph?.freshness_max_age_hours || 24;
  const metadataPath = resolve(repoRoot, outputPath, "graph-metadata.json");

  if (!existsSync(metadataPath)) {
    console.log("STATUS: Graph data is missing (never generated).");
    console.log(`  Expected at: ${metadataPath}`);
    console.log("  Run: node scripts/refresh-graph.mjs");
    process.exit(2);
  }

  const stats = statSync(metadataPath);
  const ageMs = Date.now() - stats.mtimeMs;
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours > maxAgeHours) {
    console.log(
      `STATUS: Graph data is stale (${ageHours.toFixed(1)} hours old, max ${maxAgeHours}h).`,
    );
    console.log("  Run: node scripts/refresh-graph.mjs");
    process.exit(1);
  }

  console.log(
    `STATUS: Graph data is fresh (${ageHours.toFixed(1)} hours old, max ${maxAgeHours}h).`,
  );
  process.exit(0);
}

main();
