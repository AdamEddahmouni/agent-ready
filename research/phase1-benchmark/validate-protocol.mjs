/**
 * Validates Phase 1 benchmark protocol v1 JSON artifacts.
 * Does not run evaluation — structural checks only.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "docs/research/phase1-benchmark-protocol/v1");

const FROZEN_PATHS = [
  "docs/research/phase1-benchmark-protocol/v1/PROTOCOL.md",
  "docs/research/phase1-benchmark-protocol/v1/decision-rule.json",
  "docs/research/phase1-benchmark-protocol/v1/manifest.json",
  "docs/research/phase1-benchmark-protocol/v1/repositories.json",
  "docs/research/phase1-benchmark-protocol/v1/run-manifest.template.json",
  "docs/research/phase1-benchmark-protocol/v1/tasks.json",
  "schemas/research/phase1-benchmark-raw-run-v1.schema.json",
  "schemas/research/phase1-benchmark-run-manifest-v1.schema.json",
];

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
  if (typeof oracle !== "object" || oracle === null) {
    fail(`task ${taskId} has no successOracle`);
  }
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

function verifyFreezeRecord() {
  const freezePath = join(root, "FROZEN.sha256");
  if (!existsSync(freezePath)) fail(`missing ${freezePath}`);

  const expected = new Map();
  for (const line of readFileSync(freezePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(trimmed);
    if (!match) fail(`invalid freeze record line: ${line}`);
    const [, digest, artifact] = match;
    if (!digest || !artifact) fail(`invalid freeze record line: ${line}`);
    if (expected.has(artifact)) fail(`duplicate freeze record for ${artifact}`);
    expected.set(artifact, digest);
  }

  if (expected.size !== FROZEN_PATHS.length) {
    fail(
      `freeze record lists ${String(expected.size)} artifacts; expected ${String(FROZEN_PATHS.length)}`,
    );
  }
  for (const artifact of FROZEN_PATHS) {
    if (!expected.has(artifact)) fail(`freeze record is missing ${artifact}`);
    const digest = createHash("sha256")
      .update(readFileSync(join(process.cwd(), artifact)))
      .digest("hex");
    if (digest !== expected.get(artifact)) {
      fail(`frozen artifact changed: ${artifact}; create protocol v2 instead`);
    }
  }
  for (const artifact of expected.keys()) {
    if (!FROZEN_PATHS.includes(artifact)) fail(`freeze record includes unexpected ${artifact}`);
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
if (manifest.runsPerTaskPerCondition !== 3) {
  fail("protocol v1 fixes runsPerTaskPerCondition at 3");
}
if (!Array.isArray(manifest.conditions) || manifest.conditions.length !== 2) {
  fail("protocol v1 must declare exactly two conditions");
}
const conditionIds = new Set(manifest.conditions.map((entry) => entry.id));
if (conditionIds.size !== 2 || !conditionIds.has("raw") || !conditionIds.has("agent-ready")) {
  fail("protocol v1 conditions must be raw and agent-ready");
}

if (!Array.isArray(repos.repositories) || repos.repositories.length !== 5) {
  fail("protocol v1 must pin exactly 5 repositories");
}
const repoIds = new Set();
for (const repo of repos.repositories) {
  if (typeof repo.id !== "string" || repo.id.length === 0) {
    fail("repository id must be a non-empty string");
  }
  if (repoIds.has(repo.id)) fail(`duplicate repository id ${repo.id}`);
  repoIds.add(repo.id);
  if (!/^[0-9a-f]{40}$/.test(repo.commit)) {
    fail(`repository ${repo.id} must be pinned to a full 40-character commit SHA`);
  }
}

if (!Array.isArray(tasks.tasks) || tasks.tasks.length !== 13) {
  fail("protocol v1 must contain exactly 13 tasks");
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
  if (!Array.isArray(task.forbidden)) fail(`task ${task.id} has no forbidden list`);
  if (!Array.isArray(task.verificationSurface) || task.verificationSurface.length === 0) {
    fail(`task ${task.id} has no verificationSurface`);
  }
  if (!Number.isInteger(task.timeoutMinutes) || task.timeoutMinutes < 1) {
    fail(`task ${task.id} must have a positive integer timeoutMinutes`);
  }
  if (task.responseFormat === "json" && task.successOracle.type !== "response-json-path-equals") {
    fail(`task ${task.id} declares a JSON response but does not score it as JSON`);
  }
  checkOracle(task.successOracle, task.id);
}

const perCondition = tasks.tasks.length * manifest.runsPerTaskPerCondition;
if (perCondition !== 39) fail("protocol v1 must define 39 trials per condition");
if (perCondition * manifest.conditions.length !== 78) {
  fail("protocol v1 must define 78 trials in total");
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

verifyFreezeRecord();

console.log(
  `protocol v1 ok: ${String(repos.repositories.length)} repos, ${String(tasks.tasks.length)} tasks, ${String(perCondition)} trials per condition, ${String(perCondition * manifest.conditions.length)} total`,
);
