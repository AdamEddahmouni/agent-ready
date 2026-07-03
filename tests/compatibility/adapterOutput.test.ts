import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runGenerate } from "../../src/cli/commands/generate.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import { createTestRepo } from "../integration/testRepo.js";

interface CorpusFile {
  readonly path: string;
  readonly content?: string;
  readonly source?: string;
}

interface CorpusOutput {
  readonly adapter: string;
  readonly path: string;
  readonly fixture: string;
}

interface CorpusCase {
  readonly name: string;
  readonly contract: string;
  readonly files: readonly CorpusFile[];
  readonly outputs: readonly CorpusOutput[];
}

interface CorpusManifest {
  readonly version: number;
  readonly cases: readonly CorpusCase[];
}

const corpusRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "compatibility",
  "adapter-output",
  "v1",
);
const manifest = JSON.parse(
  await readFile(join(corpusRoot, "manifest.json"), "utf8"),
) as CorpusManifest;

describe(`adapter output compatibility corpus v${String(manifest.version)}`, () => {
  for (const corpusCase of manifest.cases) {
    it(`matches every byte for ${corpusCase.name}`, async () => {
      const files: Record<string, string> = {
        "agent-ready.yaml": await readFile(join(corpusRoot, corpusCase.contract), "utf8"),
      };
      for (const input of corpusCase.files) {
        files[input.path] =
          input.source === undefined
            ? (input.content ?? "")
            : await readFile(join(corpusRoot, input.source), "utf8");
      }

      const testRepo = await createTestRepo(files);
      try {
        const outcome = await runGenerate(
          new NodeFileSystem(),
          { json: false, write: true, check: false, force: false },
          testRepo.root,
        );
        expect(outcome.exitCode).toBe(ExitCode.SUCCESS);

        for (const output of corpusCase.outputs) {
          const [actual, expected] = await Promise.all([
            readFile(join(testRepo.root, output.path), "utf8"),
            readFile(join(corpusRoot, output.fixture), "utf8"),
          ]);
          expect(actual, `${corpusCase.name}/${output.adapter}`).toBe(expected);
        }
      } finally {
        await testRepo.cleanup();
      }
    });
  }
});
