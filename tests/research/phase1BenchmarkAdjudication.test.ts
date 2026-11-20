import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adjudicateManualRubric,
  parseAdjudications,
  parseUnnecessaryReadAdjudications,
  readAdjudicationFile,
  readUnnecessaryReadAdjudicationFile,
  serializeAdjudications,
  serializeUnnecessaryReadAdjudications,
  unnecessaryReadAdjudicationMap,
  writeAdjudicationFile,
  writeUnnecessaryReadAdjudicationFile,
  type ManualRubricReview,
} from "../../research/phase1-benchmark/adjudication.js";

const agreedReviews: readonly [ManualRubricReview, ManualRubricReview] = [
  { reviewerId: "reviewer-a", passed: true },
  { reviewerId: "reviewer-b", passed: true },
];

let baseDirectory: string;

beforeEach(async () => {
  baseDirectory = await mkdtemp(join(tmpdir(), "phase1-adjudication-test-"));
});

afterEach(async () => {
  await rm(baseDirectory, { recursive: true, force: true });
});

describe("manual-rubric adjudication", () => {
  it("rejects a single reviewer and duplicate reviewers", () => {
    expect(() =>
      adjudicateManualRubric({
        runKey: "run-1",
        rubricId: "rubric-1",
        reviews: [{ reviewerId: "reviewer-a", passed: true }],
      }),
    ).toThrow(/exactly two reviewers/);
    expect(() =>
      adjudicateManualRubric({
        runKey: "run-1",
        rubricId: "rubric-1",
        reviews: [
          { reviewerId: "reviewer-a", passed: true },
          { reviewerId: "reviewer-a", passed: false },
        ],
      }),
    ).toThrow(/distinct reviewers/);
  });

  it("accepts agreement from two reviewers without a third", () => {
    const result = adjudicateManualRubric({
      runKey: "run-1",
      rubricId: "rubric-1",
      reviews: agreedReviews,
    });
    expect(result.passed).toBe(true);
    expect(result.resolution).toBe("agreement");
    expect(result.reviews).toHaveLength(2);
  });

  it("requires a distinct third reviewer only when the first two disagree", () => {
    const disagreement: readonly [ManualRubricReview, ManualRubricReview] = [
      { reviewerId: "reviewer-a", passed: true },
      { reviewerId: "reviewer-b", passed: false },
    ];
    expect(() =>
      adjudicateManualRubric({
        runKey: "run-1",
        rubricId: "rubric-1",
        reviews: disagreement,
      }),
    ).toThrow(/third reviewer/);
    expect(() =>
      adjudicateManualRubric({
        runKey: "run-1",
        rubricId: "rubric-1",
        reviews: disagreement,
        tiebreak: { reviewerId: "reviewer-a", passed: false },
      }),
    ).toThrow(/distinct from both/);

    const result = adjudicateManualRubric({
      runKey: "run-1",
      rubricId: "rubric-1",
      reviews: disagreement,
      tiebreak: { reviewerId: "reviewer-c", passed: false },
    });
    expect(result.passed).toBe(false);
    expect(result.resolution).toBe("third-reviewer");
    expect(result.tiebreak?.reviewerId).toBe("reviewer-c");
  });

  it("stores adjudications separately and cannot parse a single-reviewer record", async () => {
    const adjudication = adjudicateManualRubric({
      runKey: "run-1",
      rubricId: "rubric-1",
      reviews: agreedReviews,
    });
    const path = join(baseDirectory, "adjudications.json");
    const rawPath = join(baseDirectory, "raw", "run-1.json");
    await mkdir(join(baseDirectory, "raw"), { recursive: true });
    await writeFile(rawPath, '{"raw":"unchanged"}\n', "utf8");
    await writeAdjudicationFile(path, [adjudication]);
    const text = await readFile(path, "utf8");
    expect(text).not.toContain("condition");
    expect(JSON.parse(text)).toEqual({
      protocolVersion: 1,
      adjudications: [adjudication],
    });
    const loaded = await readAdjudicationFile(path);
    expect(loaded.adjudications).toEqual([adjudication]);
    expect(await readFile(rawPath, "utf8")).toBe('{"raw":"unchanged"}\n');

    const invalid = JSON.stringify({
      protocolVersion: 1,
      adjudications: [
        {
          runKey: "run-2",
          rubricId: "rubric-2",
          passed: true,
          resolution: "agreement",
          reviews: [{ reviewerId: "only-reviewer", passed: true }],
        },
      ],
    });
    expect(() => parseAdjudications(invalid)).toThrow(/exactly two reviewers/);
    expect(() => serializeAdjudications([adjudication, adjudication])).toThrow(/duplicate/);
  });

  it("round-trips the unnecessary-read sidecar and rejects malformed counts", async () => {
    const first = {
      runKey: "manifest#task-b#raw#0",
      unnecessaryFileReads: 2,
    } as const;
    const second = {
      runKey: "manifest#task-a#agent-ready#1",
      unnecessaryFileReads: 0,
    } as const;
    const text = serializeUnnecessaryReadAdjudications([first, second]);
    expect(JSON.parse(text)).toEqual({
      protocolVersion: 1,
      unnecessaryFileReads: [second, first],
    });
    expect(parseUnnecessaryReadAdjudications(text).unnecessaryFileReads).toEqual([second, first]);
    expect(() => serializeUnnecessaryReadAdjudications([first, first])).toThrow(/duplicate/);
    expect(() =>
      parseUnnecessaryReadAdjudications(
        JSON.stringify({
          protocolVersion: 1,
          unnecessaryFileReads: [{ runKey: "run-1", unnecessaryFileReads: -1 }],
        }),
      ),
    ).toThrow(/non-negative integer/);
    expect(() =>
      parseUnnecessaryReadAdjudications(
        JSON.stringify({ protocolVersion: 2, unnecessaryFileReads: [] }),
      ),
    ).toThrow(/protocolVersion 1/);

    const path = join(baseDirectory, "read-adjudications.json");
    await writeUnnecessaryReadAdjudicationFile(path, [first, second]);
    const loaded = await readUnnecessaryReadAdjudicationFile(path);
    expect(unnecessaryReadAdjudicationMap(loaded)).toEqual({
      "manifest#task-a#agent-ready#1": { unnecessaryFileReads: 0 },
      "manifest#task-b#raw#0": { unnecessaryFileReads: 2 },
    });
  });
});
