import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeTree } from "../../src/filesystem/removeTree.js";
import {
  aggregateRuns,
  evaluateAggregateDecision,
} from "../../research/phase1-benchmark/aggregate.js";
import {
  buildBenchmarkReport,
  renderReportJson,
  renderReportMarkdown,
  ReportCompletenessError,
  validateReportCompleteness,
  type RawRunFile,
} from "../../research/phase1-benchmark/report.js";
import {
  readDecisionRule,
  readRawRunFiles,
  reproduceFromRaw,
} from "../../research/phase1-benchmark/reproduce.js";
import type { RawRunRecord } from "../../research/phase1-benchmark/harness/record.js";

function makeRun(overrides: Partial<RawRunRecord> = {}): RawRunRecord {
  return {
    protocolVersion: 1,
    runManifestId: "manifest-report",
    taskId: "task-a",
    condition: "raw",
    runIndex: 0,
    startTime: "2026-11-17T00:00:00.000Z",
    endTime: "2026-11-17T00:01:00.000Z",
    success: true,
    toolCalls: [],
    fileReads: [],
    fileWrites: [],
    tokenMetrics: { input: null, output: null, cached: null, reasoning: null },
    assumptions: [],
    dependencyReasoningFindings: [],
    verificationSelectionResult: true,
    infrastructureFailure: false,
    ...overrides,
  };
}

function rawFile(record: RawRunRecord, file: string): RawRunFile {
  const bytes = `${JSON.stringify(record, null, 2)}\n`;
  return {
    file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    record,
  };
}

async function writeRawFiles(directory: string, files: readonly RawRunFile[]): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const file of files) {
    await writeFile(
      join(directory, file.file),
      `${JSON.stringify(file.record, null, 2)}\n`,
      "utf8",
    );
  }
}

const RECORDS = [
  makeRun({ runIndex: 0, success: true }),
  makeRun({ runIndex: 1, success: false }),
  makeRun({ condition: "agent-ready", runIndex: 0, success: true }),
  makeRun({ condition: "agent-ready", runIndex: 1, success: true }),
  makeRun({ runIndex: 2, infrastructureFailure: true }),
];

const FILES = RECORDS.map((record, index) =>
  rawFile(record, `run-${String(index).padStart(2, "0")}.json`),
);

let baseDirectory: string;

beforeEach(async () => {
  baseDirectory = await mkdtemp(join(tmpdir(), "phase1-report-test-"));
});

afterEach(async () => {
  await removeTree(baseDirectory);
});

describe("benchmark report", () => {
  it("includes every valid run and rejects an omitted run", async () => {
    const rule = await readDecisionRule();
    const aggregation = aggregateRuns(RECORDS);
    const decision = evaluateAggregateDecision(rule, aggregation).decision;
    const report = buildBenchmarkReport({ rawFiles: FILES, aggregation, decision });

    expect(report.validRuns).toHaveLength(4);
    expect(report.excludedRuns).toHaveLength(1);
    expect(report.checksums.files).toHaveLength(5);
    expect(report.checksums.combined).toHaveLength(64);
    expect(report.runManifestIds).toEqual(["manifest-report"]);
    validateReportCompleteness(report, FILES);

    for (const run of report.validRuns)
      expect(report.validRuns.map((entry) => entry.key)).toContain(run.key);
    const markdown = renderReportMarkdown(report);
    for (const run of report.validRuns) expect(markdown).toContain(run.key);
    expect(markdown).toContain("## Per-task results");
    expect(markdown).toContain("## Checksums");
    expect(markdown).toContain(report.checksums.combined);

    const parsed = JSON.parse(renderReportJson(report)) as { validRuns: { key: string }[] };
    expect(parsed.validRuns).toHaveLength(4);

    const incomplete = { ...report, validRuns: report.validRuns.slice(1) };
    expect(() => {
      validateReportCompleteness(incomplete, FILES);
    }).toThrow(ReportCompletenessError);
    try {
      validateReportCompleteness(incomplete, FILES);
    } catch (error) {
      expect(error).toBeInstanceOf(ReportCompletenessError);
      expect((error as ReportCompletenessError).missing).toEqual([report.validRuns[0]?.key]);
    }
  });

  it("reproduces metrics and reports byte-for-byte and detects drift", async () => {
    const rawDirectory = join(baseDirectory, "raw");
    const outputDirectory = join(baseDirectory, "run");
    await writeRawFiles(rawDirectory, FILES);
    const rule = await readDecisionRule();

    const first = await reproduceFromRaw({ rawDirectory, outputDirectory, rule });
    const reportJson = await readFile(join(outputDirectory, "report", "report.json"), "utf8");
    const reportMarkdown = await readFile(join(outputDirectory, "report", "report.md"), "utf8");
    const metrics = JSON.parse(
      await readFile(join(outputDirectory, "derived", "metrics.json"), "utf8"),
    ) as { validRunCount: number; checksums: { combined: string } };

    expect(reportJson).toBe(first.outputs.reportJson);
    expect(reportMarkdown).toBe(first.outputs.reportMarkdown);
    expect(metrics.validRunCount).toBe(4);
    expect(metrics.checksums.combined).toBe(first.report.checksums.combined);
    await expect(
      reproduceFromRaw({ rawDirectory, outputDirectory, rule, check: true }),
    ).resolves.toBeDefined();

    await writeFile(
      join(rawDirectory, "run-extra.json"),
      `${JSON.stringify(makeRun({ runIndex: 99 }), null, 2)}\n`,
      "utf8",
    );
    await expect(
      reproduceFromRaw({ rawDirectory, outputDirectory, rule, check: true }),
    ).rejects.toThrow(/reproducible output differs/);
  });

  it("rejects malformed raw files instead of silently skipping them", async () => {
    const rawDirectory = join(baseDirectory, "raw");
    await mkdir(rawDirectory, { recursive: true });
    await writeFile(join(rawDirectory, "bad.json"), '{"not":"a run"}\n', "utf8");
    await expect(readRawRunFiles(rawDirectory)).rejects.toThrow(
      /raw run record failed schema validation/,
    );
  });
});
