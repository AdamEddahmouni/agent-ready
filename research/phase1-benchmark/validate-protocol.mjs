/**
 * Validates Phase 1 benchmark protocol v1 JSON artifacts.
 * Does not run evaluation — structural checks only.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "docs/research/phase1-benchmark-protocol/v1");

const ORACLE_TYPES = new Set([
  "response-json-path-equals",
  "file-contains",
  "file-json-equals",
  "command-exit-zero",
  "manual-rubric",
  "all-of",
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function load(name) {
  const path = join(root, name);
  if (!existsSync(path)) fail(`missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function checkOracle(oracle, taskId) {
  if (!ORACLE_TYPES.has(oracle.type)) fail(`task ${taskId} has unknown oracle type ${oracle.type}`);
  if (oracle.type === "manual-rubric") {
    if (typeof oracle.rubricId !== "string" || oracle.rubricId.length === 0) {
      fail(`task ${taskId} manual-rubric oracle is missing rubricId`);
    }
    if (typeof oracle.rubric !== "string" || oracle.rubric.length === 0) {
      fail(`task ${taskId} manual-rubric oracle is missing rubric text`);
    }
  }
  if (oracle.type === "all-of") {
    if (!Array.isArray(oracle.clauses) || oracle.clauses.length === 0) {
      fail(`task ${taskId} all-of oracle needs at least one clause`);
    }
    for (const clause of oracle.clauses) checkOracle(clause, taskId);
  }
}

const manifest = load("manifest.json");
const repos = load("repositories.json");
const tasks = load("tasks.json");
const rule = load("decision-rule.json");

if (manifest.protocolVersion !== 1) fail("manifest protocolVersion must be 1");
if (repos.protocolVersion !== 1 || tasks.protocolVersion !== 1 || rule.protocolVersion !== 1) {
  fail("protocolVersion mismatch");
}

if (!Number.isInteger(manifest.runsPerTaskPerCondition) || manifest.runsPerTaskPerCondition < 1) {
  fail("runsPerTaskPerCondition must be a positive integer");
}

const repoIds = new Set(repos.repositories.map((entry) => entry.id));
for (const repo of repos.repositories) {
  if (!/^[0-9a-f]{40}$/.test(repo.commit)) {
    fail(`repository ${repo.id} must be pinned to a full 40-character commit SHA`);
  }
}

const taskIds = new Set();
for (const task of tasks.tasks) {
  if (taskIds.has(task.id)) fail(`duplicate task id ${task.id}`);
  taskIds.add(task.id);
  if (!repoIds.has(task.repositoryId)) {
    fail(`task ${task.id} references unknown repo ${task.repositoryId}`);
  }
  if (typeof task.prompt !== "string" || task.prompt.trim().length === 0) {
    fail(`task ${task.id} has no prompt`);
  }
  if (task.responseFormat === "json" && task.successOracle.type !== "response-json-path-equals") {
    fail(`task ${task.id} declares a JSON response but does not score it as JSON`);
  }
  checkOracle(task.successOracle, task.id);
}

if (typeof rule.primaryGate.maxAbsoluteDrop !== "number") {
  fail("primary gate must use maxAbsoluteDrop (absolute proportion)");
}
for (const gate of rule.safetyGates) {
  if (typeof gate.maxAbsoluteIncrease !== "number") {
    fail(`safety gate ${gate.metric} must use maxAbsoluteIncrease (absolute proportion)`);
  }
}
if (typeof rule.benefitGate.minimumBaselineMedian !== "number") {
  fail("benefit gate must declare minimumBaselineMedian");
}

const trials =
  repos.repositories.length > 0 ? tasks.tasks.length * manifest.runsPerTaskPerCondition : 0;
console.log(
  `protocol v1 ok: ${String(repos.repositories.length)} repos, ${String(tasks.tasks.length)} tasks, ${String(trials)} trials per condition`,
);
