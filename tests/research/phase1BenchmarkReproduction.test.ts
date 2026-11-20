import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readUnnecessaryReadAdjudicationFile,
  unnecessaryReadAdjudicationMap,
} from "../../research/phase1-benchmark/adjudication.js";
import { readDecisionRule, reproduceFromRaw } from "../../research/phase1-benchmark/reproduce.js";

const FIXTURE_DIRECTORY = "research/phase1-benchmark/fixtures/reproduction";
const RAW_DIRECTORY = join(FIXTURE_DIRECTORY, "raw");
const ADJUDICATIONS_PATH = join(FIXTURE_DIRECTORY, "adjudications.json");

let outputDirectory: string;

beforeEach(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), "phase1-reproduction-fixture-"));
});

afterEach(async () => {
  await rm(outputDirectory, { recursive: true, force: true });
});

describe("committed reproduction fixture", () => {
  it("reproduces the committed report byte-for-byte with the sidecar applied", async () => {
    const rule = await readDecisionRule();
    const adjudications = unnecessaryReadAdjudicationMap(
      await readUnnecessaryReadAdjudicationFile(ADJUDICATIONS_PATH),
    );
    const result = await reproduceFromRaw({
      rawDirectory: RAW_DIRECTORY,
      outputDirectory: FIXTURE_DIRECTORY,
      rule,
      adjudications,
      check: true,
    });

    expect(result.report.validRuns).toHaveLength(5);
    expect(result.report.excludedRuns.map((run) => run.reason)).toEqual([
      "forbidden-action",
      "infrastructure-failure",
    ]);
    expect(result.report.decision).toBe("noDemonstratedBenefit");
    expect(result.report.summaries.raw.unnecessaryFileReadsMedian).toBe(1.5);
    expect(
      result.report.validRuns.find((run) => run.key.endsWith("#raw#0"))?.unnecessaryFileReads,
    ).toBe(1);
    expect(result.report.checksums.combined).toBe(
      "230614035c1d57983907dec4079ca8d76d3cdeb0195277e3afe22f3c78d7082b",
    );
  });

  it("shows the sidecar changing the median and the decision", async () => {
    const rule = await readDecisionRule();
    const result = await reproduceFromRaw({
      rawDirectory: RAW_DIRECTORY,
      outputDirectory,
      rule,
    });

    expect(result.report.summaries.raw.unnecessaryFileReadsMedian).toBe(2.5);
    expect(result.report.decision).toBe("helps");
  });

  it("fails closed when the sidecar names a run that is not in the raw set", async () => {
    const rule = await readDecisionRule();
    await expect(
      reproduceFromRaw({
        rawDirectory: RAW_DIRECTORY,
        outputDirectory,
        rule,
        adjudications: {
          "fixture-reproduction-2026-11-17#missing#raw#0": { unnecessaryFileReads: 0 },
        },
      }),
    ).rejects.toThrow(/unknown raw run key/);
  });
});
