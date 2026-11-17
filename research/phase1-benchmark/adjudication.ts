import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ManualRubricReview {
  readonly reviewerId: string;
  readonly passed: boolean;
  readonly notes?: string;
}

export type AdjudicationResolution = "agreement" | "third-reviewer";

export interface ManualRubricAdjudication {
  readonly runKey: string;
  readonly rubricId: string;
  readonly passed: boolean;
  readonly resolution: AdjudicationResolution;
  readonly reviews: readonly [ManualRubricReview, ManualRubricReview];
  readonly tiebreak?: ManualRubricReview;
}

export interface AdjudicationFile {
  readonly protocolVersion: 1;
  readonly adjudications: readonly ManualRubricAdjudication[];
}

function nonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) throw new Error(`${field} must not be empty`);
  return value;
}

function validateReview(review: ManualRubricReview): void {
  nonEmpty(review.reviewerId, "reviewerId");
  if (typeof review.passed !== "boolean") {
    throw new Error(`review by ${review.reviewerId} must record a boolean passed value`);
  }
}

/**
 * Applies the blinded manual-rubric rule. Exactly two independent reviewers
 * score the run. Agreement is final; disagreement requires a third reviewer
 * who did not participate in the first two.
 */
export function adjudicateManualRubric(input: {
  readonly runKey: string;
  readonly rubricId: string;
  readonly reviews: readonly ManualRubricReview[];
  readonly tiebreak?: ManualRubricReview;
}): ManualRubricAdjudication {
  nonEmpty(input.runKey, "runKey");
  nonEmpty(input.rubricId, "rubricId");
  if (input.reviews.length !== 2) {
    throw new Error("manual-rubric adjudication requires exactly two reviewers");
  }
  const first = input.reviews[0];
  const second = input.reviews[1];
  if (first === undefined || second === undefined) {
    throw new Error("manual-rubric adjudication requires exactly two reviewers");
  }
  validateReview(first);
  validateReview(second);
  if (first.reviewerId === second.reviewerId) {
    throw new Error("manual-rubric adjudication requires two distinct reviewers");
  }

  if (first.passed === second.passed) {
    if (input.tiebreak !== undefined) {
      throw new Error("a tiebreak reviewer is only valid when the first two reviewers disagree");
    }
    return {
      runKey: input.runKey,
      rubricId: input.rubricId,
      passed: first.passed,
      resolution: "agreement",
      reviews: [first, second],
    };
  }

  const tiebreak = input.tiebreak;
  if (tiebreak === undefined) {
    throw new Error("disagreement requires a third reviewer");
  }
  validateReview(tiebreak);
  if (tiebreak.reviewerId === first.reviewerId || tiebreak.reviewerId === second.reviewerId) {
    throw new Error("the tiebreak reviewer must be distinct from both initial reviewers");
  }
  return {
    runKey: input.runKey,
    rubricId: input.rubricId,
    passed: tiebreak.passed,
    resolution: "third-reviewer",
    reviews: [first, second],
    tiebreak,
  };
}

function canonicalAdjudications(
  rows: readonly ManualRubricAdjudication[],
): ManualRubricAdjudication[] {
  const sorted = [...rows].sort((left, right) => {
    const leftKey = `${left.runKey}\u0000${left.rubricId}`;
    const rightKey = `${right.runKey}\u0000${right.rubricId}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const seen = new Set<string>();
  for (const row of sorted) {
    const key = `${row.runKey}\u0000${row.rubricId}`;
    if (seen.has(key)) {
      throw new Error(`duplicate adjudication for ${row.runKey} / ${row.rubricId}`);
    }
    seen.add(key);
    const recomputed = adjudicateManualRubric({
      runKey: row.runKey,
      rubricId: row.rubricId,
      reviews: row.reviews,
      ...(row.tiebreak !== undefined && { tiebreak: row.tiebreak }),
    });
    if (recomputed.passed !== row.passed || recomputed.resolution !== row.resolution) {
      throw new Error(`stored adjudication for ${row.runKey} / ${row.rubricId} is inconsistent`);
    }
  }
  return sorted;
}

export function serializeAdjudications(rows: readonly ManualRubricAdjudication[]): string {
  const adjudications = canonicalAdjudications(rows);
  return `${JSON.stringify({ protocolVersion: 1, adjudications }, null, 2)}\n`;
}

export function parseAdjudications(text: string): AdjudicationFile {
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("adjudication file must be a JSON object");
  }
  const document = parsed as Record<string, unknown>;
  if (document["protocolVersion"] !== 1) {
    throw new Error("adjudication file must declare protocolVersion 1");
  }
  if (!Array.isArray(document["adjudications"])) {
    throw new Error("adjudication file must contain an adjudications array");
  }
  const rawAdjudications: unknown[] = document["adjudications"] as unknown[];
  const rows = rawAdjudications.map((value): ManualRubricAdjudication => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("adjudication entries must be objects");
    }
    return value as ManualRubricAdjudication;
  });
  return { protocolVersion: 1, adjudications: canonicalAdjudications(rows) };
}

export async function writeAdjudicationFile(
  path: string,
  rows: readonly ManualRubricAdjudication[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeAdjudications(rows), "utf8");
}

export async function readAdjudicationFile(path: string): Promise<AdjudicationFile> {
  return parseAdjudications(await readFile(path, "utf8"));
}
