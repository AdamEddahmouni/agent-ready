#!/usr/bin/env node

/**
 * refresh-graph.mjs — Refresh the structural graph for the project.
 *
 * This script invokes the graph provider (graphify) to regenerate the
 * structural dependency graph. It reads .devbrain/project.yaml for
 * configuration and respects the graph.provider and graph.output_path
 * settings.
 *
 * No network calls, no external services beyond the graph provider binary.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function readConfig() {
  const path = resolve(repoRoot, ".devbrain", "project.yaml");
  if (!existsSync(path)) {
    console.error("ERROR: .devbrain/project.yaml not found.");
    process.exit(1);
  }
  return parseYaml(readFileSync(path, "utf8"));
}

function main() {
  console.log("Refreshing structural graph...\n");

  const config = readConfig();
  const graphConfig = config.graph;
  const outputPath = resolve(repoRoot, graphConfig.output_path || "docs/graph/");

  if (graphConfig.provider === "graphify") {
    try {
      const result = execFileSync("graphify", ["--output", outputPath], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 60_000,
        stdio: "pipe",
      });
      console.log(result);
    } catch (err) {
      if (err.code === "ENOENT") {
        console.log("Graphify CLI not found on PATH. Creating placeholder graph data.\n");
        // Create graph output directory and a placeholder
        mkdirSync(outputPath, { recursive: true });
        const timestamp = new Date().toISOString();
        writeFileSync(
          resolve(outputPath, "graph-metadata.json"),
          JSON.stringify(
            {
              provider: "graphify",
              generated_at: timestamp,
              status: "placeholder",
              note: "Install graphify CLI for full graph generation.",
            },
            null,
            2,
          ) + "\n",
        );
        console.log(`  Placeholder written to ${outputPath}/graph-metadata.json`);
      } else {
        console.error(`Graph refresh failed: ${err.message}`);
        process.exit(1);
      }
    }
  } else {
    console.log(`Graph provider "${graphConfig.provider}" not supported by this script.`);
  }

  console.log("\nGraph refresh complete.");
}

main();
