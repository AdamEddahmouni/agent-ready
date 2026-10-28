/**
 * Validates Phase 1 benchmark protocol v1 JSON artifacts.
 * Does not run evaluation — synthetic checks only.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "docs/research/phase1-benchmark-protocol/v1");

function load(name) {
  const path = join(root, name);
  if (!existsSync(path)) {
    console.error(`missing ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

const manifest = load("manifest.json");
const repos = load("repositories.json");
const tasks = load("tasks.json");
const rule = load("decision-rule.json");

if (manifest.protocolVersion !== 1) process.exit(1);
if (repos.protocolVersion !== 1 || tasks.protocolVersion !== 1 || rule.protocolVersion !== 1) {
  console.error("protocolVersion mismatch");
  process.exit(1);
}

const repoIds = new Set(repos.repositories.map((entry) => entry.id));
for (const task of tasks.tasks) {
  if (!repoIds.has(task.repositoryId)) {
    console.error(`task ${task.id} references unknown repo ${task.repositoryId}`);
    process.exit(1);
  }
}

console.log(
  `protocol v1 ok: ${String(repos.repositories.length)} repos, ${String(tasks.tasks.length)} tasks`,
);
