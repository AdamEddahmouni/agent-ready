import { createHash } from "node:crypto";
import type {
  AggregationResult,
  ExcludedRun,
  RunAdjudication,
  RunMetricValues,
  TaskAggregate,
  ConditionAggregate,
} from "./aggregate.js";
import { exclusionReason, runKey, runMetricValues } from "./aggregate.js";
import type { BenchmarkDecision } from "./evaluate-decision.mjs";
import type { RawRunRecord } from "./harness/record.js";
import type { Condition, ProtocolVersion } from "./harness/types.js";

export interface RawRunFile {
  /** Path relative to the raw run directory. */
  readonly file: string;
  readonly sha256: string;
  readonly record: RawRunRecord;
}

/**
 * One report covers one protocol version. A v1 record and a v2 record answer
 * the same task under different frozen oracles, so mixing them in a single
 * aggregate would silently blend two measurements.
 */
export function uniformProtocolVersion(files: readonly RawRunFile[]): ProtocolVersion {
  const versions = new Set<ProtocolVersion>(files.map((file) => file.record.protocolVersion));
  if (versions.size !== 1) {
    throw new Error(
      `cannot report mixed protocol versions: ${[...versions].map(String).sort().join(", ")}`,
    );
  }
  const [version] = versions;
  if (version === undefined) throw new Error("no raw runs to report");
  return version;
}

export interface ReportChecksums {
  readonly algorithm: "sha256";
  readonly combined: string;
  readonly files: readonly { readonly file: string; readonly sha256: string }[];
}

export interface ReportRun {
  readonly key: string;
  readonly taskId: string;
  readonly condition: Condition;
  readonly runIndex: number;
  readonly success: boolean;
  readonly timeToFirstCorrectModification: number | null;
  readonly invalidAssumptions: number;
  readonly dependencyReasoningFindings: number;
  readonly verificationSelectionFailure: boolean;
  readonly unnecessaryFileReads: number;
}

export interface BenchmarkReport {
  readonly protocolVersion: ProtocolVersion;
  readonly runManifestIds: readonly string[];
  readonly decision: BenchmarkDecision;
  readonly summaries: Readonly<Record<Condition, ConditionAggregate>>;
  readonly perTask: readonly TaskAggregate[];
  readonly validRuns: readonly ReportRun[];
  readonly excludedRuns: readonly ExcludedRun[];
  readonly checksums: ReportChecksums;
  readonly limitations: readonly string[];
}

export class ReportCompletenessError extends Error {
  readonly missing: readonly string[];
  readonly extra: readonly string[];

  constructor(missing: readonly string[], extra: readonly string[]) {
    super(
      `report does not cover the raw run set: missing ${missing.length}, extra ${extra.length}`,
    );
    this.name = "ReportCompletenessError";
    this.missing = missing;
    this.extra = extra;
  }
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)].sort(compareKeys);
}

export function combinedRawChecksum(files: readonly RawRunFile[]): string {
  const lines = [...files]
    .sort((left, right) => compareKeys(left.file, right.file))
    .map((file) => `${file.sha256}  ${file.file}\n`)
    .join("");
  return createHash("sha256").update(lines).digest("hex");
}

export function reportChecksums(files: readonly RawRunFile[]): ReportChecksums {
  const sorted = [...files].sort((left, right) => compareKeys(left.file, right.file));
  return {
    algorithm: "sha256",
    combined: combinedRawChecksum(sorted),
    files: sorted.map((file) => ({ file: file.file, sha256: file.sha256 })),
  };
}

function reportRun(values: RunMetricValues): ReportRun {
  return {
    key: values.key,
    taskId: values.taskId,
    condition: values.condition,
    runIndex: values.runIndex,
    success: values.success,
    timeToFirstCorrectModification: values.timeToFirstCorrectModification,
    invalidAssumptions: values.invalidAssumptions,
    dependencyReasoningFindings: values.dependencyReasoningFindings,
    verificationSelectionFailure: values.verificationSelectionFailure,
    unnecessaryFileReads: values.unnecessaryFileReads,
  };
}

const DEFAULT_LIMITATIONS = [
  "Results are screened with the predeclared decision rule; this is not a significance test.",
  "All valid runs are reported. No best-of-N selection or task cherry-picking is applied.",
  "Wilson intervals apply to binary rates; variance is sample variance (n - 1) and is null for n < 2.",
  "Unnecessary-read counts depend on post-hoc adjudication; unadjudicated runs count only reads explicitly marked unnecessary.",
  "Manual-rubric outcomes require two reviewers and a third reviewer for disagreement; adjudications live outside raw logs.",
  "Token metrics may be null where the evaluation environment did not report them.",
] as const;

/**
 * Builds a report from the exact raw file set. Every raw run must appear either
 * as a valid run or as an explicitly excluded run; a missing or extra key is
 * rejected before the report is returned.
 */
export function buildBenchmarkReport(options: {
  readonly rawFiles: readonly RawRunFile[];
  readonly aggregation: AggregationResult;
  readonly decision: BenchmarkDecision;
  readonly adjudications?: Readonly<Record<string, RunAdjudication>>;
  readonly limitations?: readonly string[];
}): BenchmarkReport {
  const byKey = new Map<string, RawRunRecord>();
  for (const file of options.rawFiles) {
    const key = runKey(file.record);
    if (byKey.has(key)) throw new Error(`duplicate raw run key ${JSON.stringify(key)}`);
    byKey.set(key, file.record);
  }

  const validRuns = options.aggregation.validRunKeys.map((key) => {
    const record = byKey.get(key);
    if (record === undefined) {
      throw new Error(`aggregation references missing raw run ${JSON.stringify(key)}`);
    }
    return reportRun(runMetricValues(record, options.adjudications?.[key]));
  });
  validRuns.sort((left, right) => compareKeys(left.key, right.key));

  const report: BenchmarkReport = {
    protocolVersion: uniformProtocolVersion(options.rawFiles),
    runManifestIds: sortedKeys(options.rawFiles.map((file) => file.record.runManifestId)),
    decision: options.decision,
    summaries: options.aggregation.summaries,
    perTask: options.aggregation.perTask,
    validRuns,
    excludedRuns: [...options.aggregation.excludedRuns].sort((left, right) =>
      compareKeys(left.key, right.key),
    ),
    checksums: reportChecksums(options.rawFiles),
    limitations: options.limitations ?? DEFAULT_LIMITATIONS,
  };

  validateReportCompleteness(report, options.rawFiles);
  return report;
}

/**
 * Recomputes the raw run key set from the files rather than trusting the
 * aggregation. This is the check that makes an omitted run fail validation.
 */
export function validateReportCompleteness(
  report: Pick<BenchmarkReport, "validRuns" | "excludedRuns">,
  rawFiles: readonly RawRunFile[],
): void {
  const expectedValid = sortedKeys(
    rawFiles
      .filter((file) => exclusionReason(file.record) === null)
      .map((file) => runKey(file.record)),
  );
  const expectedExcluded = sortedKeys(
    rawFiles
      .filter((file) => exclusionReason(file.record) !== null)
      .map((file) => runKey(file.record)),
  );
  const actualValid = sortedKeys(report.validRuns.map((run) => run.key));
  const actualExcluded = sortedKeys(report.excludedRuns.map((run) => run.key));

  const missing = [
    ...expectedValid.filter((key) => !new Set(actualValid).has(key)),
    ...expectedExcluded.filter((key) => !new Set(actualExcluded).has(key)),
  ].sort(compareKeys);
  const extra = [
    ...actualValid.filter((key) => !new Set(expectedValid).has(key)),
    ...actualExcluded.filter((key) => !new Set(expectedExcluded).has(key)),
  ].sort(compareKeys);
  if (missing.length > 0 || extra.length > 0) {
    throw new ReportCompletenessError(missing, extra);
  }
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function number(value: number | null, digits = 2): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

function median(value: number | null): string {
  return value === null ? "n/a" : number(value, 2);
}

function interval(value: { readonly lower: number; readonly upper: number } | null): string {
  return value === null ? "n/a" : `${percent(value.lower)}–${percent(value.upper)}`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function summaryTable(report: BenchmarkReport): string[] {
  const lines = [
    "| Condition | Valid runs | Task success | 95% Wilson | Invalid assumptions | Incorrect dep. reasoning | Verification failure | Reads median |",
    "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const condition of ["raw", "agent-ready"] as const) {
    const summary = report.summaries[condition];
    lines.push(
      `| ${condition} | ${summary.n} | ${percent(summary.taskSuccessRate)} | ${interval(summary.wilson.taskSuccessRate)} | ${number(summary.invalidAssumptionRate)} | ${number(summary.incorrectDependencyReasoningRate)} | ${percent(summary.verificationSelectionFailureRate)} | ${median(summary.unnecessaryFileReadsMedian)} |`,
    );
  }
  return lines;
}

function varianceTable(report: BenchmarkReport): string[] {
  const lines = [
    "| Condition | Success variance | Invalid assumptions variance | Dep. reasoning variance | Verification failure variance | Reads variance |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const condition of ["raw", "agent-ready"] as const) {
    const variance = report.summaries[condition].variance;
    lines.push(
      `| ${condition} | ${number(variance.taskSuccessRate, 4)} | ${number(variance.invalidAssumptionRate, 4)} | ${number(variance.incorrectDependencyReasoningRate, 4)} | ${number(variance.verificationSelectionFailureRate, 4)} | ${number(variance.unnecessaryFileReads, 4)} |`,
    );
  }
  return lines;
}

function perTaskTable(report: BenchmarkReport): string[] {
  const lines = [
    "| Task | Condition | Runs | Success | 95% Wilson | Invalid assumptions | Dep. reasoning | Verification failure | Reads median |",
    "| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const task of report.perTask) {
    lines.push(
      `| ${escapeCell(task.taskId)} | ${task.condition} | ${task.n} | ${percent(task.taskSuccessRate)} | ${interval(task.wilson.taskSuccessRate)} | ${number(task.invalidAssumptionRate)} | ${number(task.incorrectDependencyReasoningRate)} | ${percent(task.verificationSelectionFailureRate)} | ${median(task.unnecessaryFileReadsMedian)} |`,
    );
  }
  return lines;
}

function runsTable(report: BenchmarkReport): string[] {
  const lines = [
    "| Run | Task | Condition | Index | Success | Time to first correct (s) | Invalid assumptions | Dep. findings | Verification failure | Unnecessary reads |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: |",
  ];
  for (const run of report.validRuns) {
    lines.push(
      `| ${escapeCell(run.key)} | ${escapeCell(run.taskId)} | ${run.condition} | ${run.runIndex} | ${run.success ? "yes" : "no"} | ${run.timeToFirstCorrectModification === null ? "n/a" : run.timeToFirstCorrectModification.toFixed(2)} | ${run.invalidAssumptions} | ${run.dependencyReasoningFindings} | ${run.verificationSelectionFailure ? "yes" : "no"} | ${run.unnecessaryFileReads} |`,
    );
  }
  return lines;
}

function excludedTable(report: BenchmarkReport): string[] {
  if (report.excludedRuns.length === 0) return ["None."];
  const lines = ["| Run | Reason |", "| --- | --- |"];
  for (const run of report.excludedRuns) {
    lines.push(`| ${escapeCell(run.key)} | ${escapeCell(run.reason)} |`);
  }
  return lines;
}

export function renderReportMarkdown(report: BenchmarkReport): string {
  const checksumLines = [
    `Combined raw checksum: \`${report.checksums.combined}\``,
    "",
    "| Raw file | SHA-256 |",
    "| --- | --- |",
    ...report.checksums.files.map((file) => `| ${escapeCell(file.file)} | \`${file.sha256}\` |`),
  ];
  return [
    "# Phase 1 benchmark report",
    "",
    `**Decision:** \`${report.decision}\``,
    "",
    `**Raw run manifests:** ${report.runManifestIds.map((id) => `\`${id}\``).join(", ")}`,
    "",
    "## Summary",
    "",
    ...summaryTable(report),
    "",
    "## Variance",
    "",
    ...varianceTable(report),
    "",
    "## Per-task results",
    "",
    ...perTaskTable(report),
    "",
    "## Valid runs",
    "",
    ...runsTable(report),
    "",
    "## Excluded runs",
    "",
    ...excludedTable(report),
    "",
    "## Limitations",
    "",
    ...report.limitations.map((limitation) => `- ${limitation}`),
    "",
    "## Checksums",
    "",
    ...checksumLines,
    "",
  ].join("\n");
}

export function renderReportJson(report: BenchmarkReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
