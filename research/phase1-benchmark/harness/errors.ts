/**
 * A harness defect that must abort the run rather than be recorded as an
 * infrastructure failure. Infrastructure failures are retried and reported;
 * a mismatched replay or an unusable transcript is a bug in the harness or its
 * inputs, and recording it as a failed trial would corrupt the benchmark.
 */
export class HarnessAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessAbortError";
  }
}
