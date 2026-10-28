/**
 * `conformance:check` and `conformance:update`.
 *
 * One driver, two modes, and the split between them is the important part.
 *
 * **check** is what CI runs. It reads the corpus, runs discovery over each
 * fixture, and compares the canonical bytes to the recorded ones. It writes
 * nothing — not to the expected files, not to the fixture trees. A conformance
 * runner that rewrote its own expectations would be asserting that the
 * implementation agrees with itself.
 *
 * **update** is what a maintainer runs on purpose, when a change to the
 * implementation is intended. It rewrites the expected snapshots, and because
 * the output is pretty deterministic JSON, `git diff` then shows exactly which
 * fields moved. That diff is the review artefact: it is where a developer finds
 * out that a *stable* field changed, which is the question ADR-0048 says any
 * expected-output change has to answer.
 *
 * Every check also validates the expected snapshot against the published schema,
 * so a corpus that drifts out of the format fails here rather than reaching a
 * consumer.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  CORPUS_SNAPSHOT_VERSION,
  corpusDirectoryName,
  displayPath,
  environmentLeaks,
  firstDifference,
  loadCorpus,
  runCase,
} from "../src/conformance/discovery.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const schema = JSON.parse(
  readFileSync("schemas/discovery/snapshot-v1.schema.json", "utf8"),
) as object;
const validate = ajv.compile(schema);

const mode = process.argv[2] === "update" ? "update" : "check";
const root = process.cwd();
const cases = loadCorpus(CORPUS_SNAPSHOT_VERSION, {
  allowMissingExpected: mode === "update",
});

if (cases.length === 0) {
  process.stderr.write(
    `No conformance cases found under conformance/discovery/${corpusDirectoryName(CORPUS_SNAPSHOT_VERSION)}.\n`,
  );
  process.exit(1);
}

interface Row {
  readonly name: string;
  readonly status: string;
  readonly schemaValid: boolean;
  readonly matched: boolean;
  readonly note: string;
}

const rows: Row[] = [];
let drift = 0;
let schemaFailures = 0;

for (const entry of cases) {
  const name = entry.metadata.name;
  let actual: string;
  try {
    actual = await runCase(entry);
  } catch (error) {
    rows.push({
      name,
      status: entry.metadata.status,
      schemaValid: false,
      matched: false,
      note: `discovery failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    drift++;
    continue;
  }

  // Every produced snapshot must validate, whatever the mode. A fixture whose
  // expected output is schema-valid but whose real output is not would mean the
  // corpus and the format have parted ways.
  const schemaValid = validate(JSON.parse(actual) as unknown);
  if (!schemaValid) {
    schemaFailures++;
    rows.push({
      name,
      status: entry.metadata.status,
      schemaValid: false,
      matched: mode === "update",
      note: `produced snapshot is not schema-valid:\n      ${ajv.errorsText(validate.errors ?? [], { separator: "\n      " })}`,
    });
  }

  if (mode === "update") {
    const target = join(entry.casePath, "expected.json");
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target) || readFileSync(target, "utf8") !== actual) {
      writeFileSync(target, actual, "utf8");
    }
    rows.push({ name, status: entry.metadata.status, schemaValid, matched: true, note: "written" });
    continue;
  }

  const matched = actual === entry.expected;
  if (matched) {
    rows.push({ name, status: entry.metadata.status, schemaValid, matched, note: "" });
    continue;
  }
  drift++;
  const leaks = environmentLeaks(entry.expected);
  rows.push({
    name,
    status: entry.metadata.status,
    schemaValid,
    matched: false,
    note:
      `CONFORMANCE DRIFT against ${displayPath(root, join(entry.casePath, "expected.json"))}\n      ` +
      firstDifference(entry.expected, actual) +
      (leaks.length > 0 ? `\n      recorded expected output leaks the environment: ${leaks.join("; ")}` : ""),
  });
}

const width = Math.max(...rows.map((row) => row.name.length), 4);
for (const row of rows) {
  const state = row.status === "known-inaccurate" ? "conforms to recorded current behaviour" : "conforms";
  const mark = row.matched ? "ok  " : "FAIL";
  const schemaMark = row.schemaValid ? "schema-valid" : "SCHEMA-INVALID";
  process.stdout.write(`${mark} ${row.name.padEnd(width)}  ${row.status.padEnd(18)} ${schemaMark}  ${row.note === "" ? state : row.note}\n`);
}

const matchedCount = rows.filter((row) => row.matched).length;
const knownInaccurate = rows.filter((row) => row.status === "known-inaccurate");
const unsupported = rows.filter((row) => row.status === "unsupported");

process.stdout.write(
  `\n${String(rows.length)} conformance cases (snapshot format ${String(CORPUS_SNAPSHOT_VERSION)})\n` +
    `  ${String(matchedCount)} match the recorded expected snapshot\n` +
    `  ${String(rows.length - matchedCount)} differ\n` +
    `  ${String(rows.length - schemaFailures)} produced a schema-valid snapshot\n` +
    `  ${String(unsupported.length)} case(s) pin an unsupported construct\n` +
    `  ${String(knownInaccurate.length)} case(s) remain KNOWN INACCURATE — unchanged, and still wrong\n`,
);

if (drift > 0) {
  process.stdout.write(
    "\nCONFORMANCE DRIFT\n\n" +
      "A differing case is a decision, not an obstacle. Before regenerating, answer these:\n" +
      "  1. Did a field listed as stable in docs/vnext/SNAPSHOT-STABILITY.md change meaning, type, or presence?\n" +
      "  2. Did a stable identity, a canonical ordering rule, or a fact discriminator change?\n" +
      "  3. If a known-inaccurate case moved, has the limitation been CLOSED rather than merely altered?\n" +
      "  4. Only if all three are no: run `pnpm conformance:update` and review the diff.\n" +
      "  If any of the first three is yes, `snapshotVersion` must change instead.\n",
  );
}

if (drift > 0 || schemaFailures > 0) {
  process.exit(1);
}
