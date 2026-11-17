import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { aggregateRuns, evaluateAggregateDecision, type AggregationResult } from "./aggregate.js";
import {
  buildBenchmarkReport,
  renderReportJson,
  renderReportMarkdown,
  type BenchmarkReport,
  type RawRunFile,
} from "./report.js";
import { recordRawRun } from "./harness/record.js";
import type { BenchmarkDecisionRule } from "./evaluate-decision.mjs";

export const DEFAULT_DECISION_RULE_PATH = fileURLToPath(
  new URL("../../docs/research/phase1-benchmark-protocol/v1/decision-rule.json", import.meta.url),
);

export interface ReproductionResult {
  readonly files: readonly RawRunFile[];
  readonly aggregation: AggregationResult;
  readonly report: BenchmarkReport;
  readonly outputs: Readonly<Record<"metrics" | "reportJson" | "reportMarkdown", string>>;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function readDecisionRule(
  path = DEFAULT_DECISION_RULE_PATH,
): Promise<BenchmarkDecisionRule> {
  return (await readJson(path)) as BenchmarkDecisionRule;
}

/**
 * Reads every top-level JSON file in the raw directory, validates each one
 * against the frozen schema, and records its SHA-256. A malformed or duplicate
 * run aborts the reproduction rather than being skipped.
 */
export async function readRawRunFiles(rawDirectory: string): Promise<RawRunFile[]> {
  const entries = await readdir(rawDirectory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) {
    throw new Error(`no raw JSON run records found in ${rawDirectory}`);
  }

  const files: RawRunFile[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const bytes = await readFile(join(rawDirectory, name));
    const record = recordRawRun(JSON.parse(bytes.toString("utf8")) as unknown);
    const key = `${record.runManifestId}#${record.taskId}#${record.condition}#${String(record.runIndex)}`;
    if (seen.has(key)) throw new Error(`duplicate raw run key ${JSON.stringify(key)}`);
    seen.add(key);
    files.push({
      file: name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      record,
    });
  }
  return files;
}

function metricsDocument(report: BenchmarkReport): string {
  return `${JSON.stringify(
    {
      protocolVersion: 1,
      runManifestIds: report.runManifestIds,
      decision: report.decision,
      summaries: report.summaries,
      perTask: report.perTask,
      validRunCount: report.validRuns.length,
      excludedRuns: report.excludedRuns,
      checksums: report.checksums,
      limitations: report.limitations,
    },
    null,
    2,
  )}\n`;
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function emit(path: string, content: string, check: boolean): Promise<void> {
  if (check) {
    const existing = await readIfPresent(path);
    if (existing === null) throw new Error(`missing reproducible output: ${path}`);
    if (existing !== content) throw new Error(`reproducible output differs: ${path}`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

/**
 * Reproduces derived metrics and reports from an immutable raw directory.
 * The output contains no timestamps or checkout paths, so equal raw bytes
 * produce byte-identical output across clean checkouts.
 */
export async function reproduceFromRaw(options: {
  readonly rawDirectory: string;
  readonly outputDirectory: string;
  readonly rule: BenchmarkDecisionRule;
  readonly check?: boolean;
}): Promise<ReproductionResult> {
  const files = await readRawRunFiles(options.rawDirectory);
  const aggregation = aggregateRuns(files.map((file) => file.record));
  const { decision } = evaluateAggregateDecision(options.rule, aggregation);
  const report = buildBenchmarkReport({
    rawFiles: files,
    aggregation,
    decision,
  });

  const outputs = {
    metrics: metricsDocument(report),
    reportJson: renderReportJson(report),
    reportMarkdown: renderReportMarkdown(report),
  };
  const check = options.check ?? false;
  await Promise.all([
    emit(join(options.outputDirectory, "derived", "metrics.json"), outputs.metrics, check),
    emit(join(options.outputDirectory, "report", "report.json"), outputs.reportJson, check),
    emit(join(options.outputDirectory, "report", "report.md"), outputs.reportMarkdown, check),
  ]);

  return { files, aggregation, report, outputs };
}

const USAGE =
  "Usage: tsx research/phase1-benchmark/reproduce.ts --raw <raw-dir> --out <run-dir> [--rule <decision-rule.json>] [--check]";

async function main(): Promise<void> {
  let values: {
    readonly raw?: string;
    readonly out?: string;
    readonly rule?: string;
    readonly check?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        raw: { type: "string" },
        out: { type: "string" },
        rule: { type: "string" },
        check: { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (values.raw === undefined || values.out === undefined) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const rule = await readDecisionRule(values.rule);
  const result = await reproduceFromRaw({
    rawDirectory: values.raw,
    outputDirectory: values.out,
    rule,
    check: values.check ?? false,
  });
  console.log(
    `${values.check === true ? "verified" : "wrote"} ${result.report.validRuns.length} valid runs; decision=${result.report.decision}; raw checksum=${result.report.checksums.combined}`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
