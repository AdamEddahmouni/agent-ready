/**
 * Issue #40: the built CLI's discover stdout is the published Snapshot Format 1.
 *
 * Internal `runDiscover` tests are necessary but not sufficient: packaging,
 * serialization, and the real filesystem path must match what consumers run.
 */

import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { environmentLeaks } from "../../src/conformance/discovery.js";
import { removeTree } from "../../src/filesystem/removeTree.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(repoRoot, "dist/cli/index.js");
const schema = JSON.parse(
  readFileSync(join(repoRoot, "schemas/discovery/snapshot-v1.schema.json"), "utf8"),
) as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

function runDiscoverJson(root: string): { stdout: string; stderr: string; exitCode: number } {
  const result = execFileSync(process.execPath, [cli, "discover", "--json", "--root", root], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return { stdout: result, stderr: "", exitCode: 0 };
}

describe("built CLI discover --json", () => {
  it.skipIf(!existsSync(cli))("emits schema-valid Snapshot Format 1 for this repository", () => {
    const { stdout } = runDiscoverJson(repoRoot);
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout.trimStart().startsWith("{")).toBe(true);
    const document = JSON.parse(stdout) as Record<string, unknown>;
    expect(document["snapshotVersion"]).toBe(1);
    expect(validate(document), ajv.errorsText(validate.errors ?? [])).toBe(true);
    expect(environmentLeaks(stdout)).toEqual([]);
    expect(stdout).not.toContain(repoRoot.replace(/\\/g, "/"));
  });

  it.skipIf(!existsSync(cli))("matches the minimal-package corpus case on disk", async () => {
    const fixture = join(repoRoot, "conformance/discovery/v1/minimal-package/repo");
    const temporary = mkdtempSync(join(tmpdir(), "agent-ready-cli-conformance-"));
    try {
      const root = join(temporary, "repo");
      cpSync(fixture, root, { recursive: true });
      mkdirSync(join(root, ".git"), { recursive: true });
      const expected = readFileSync(
        join(repoRoot, "conformance/discovery/v1/minimal-package/expected.json"),
        "utf8",
      );
      const { stdout } = runDiscoverJson(root);
      expect(stdout).toBe(expected);
    } finally {
      await removeTree(temporary);
    }
  });

  it.skipIf(!existsSync(cli))("matches the unresolved-import corpus case on disk", async () => {
    const fixture = join(repoRoot, "conformance/discovery/v1/unresolved-import/repo");
    const temporary = mkdtempSync(join(tmpdir(), "agent-ready-cli-conformance-"));
    try {
      const root = join(temporary, "repo");
      cpSync(fixture, root, { recursive: true });
      mkdirSync(join(root, ".git"), { recursive: true });
      const expected = readFileSync(
        join(repoRoot, "conformance/discovery/v1/unresolved-import/expected.json"),
        "utf8",
      );
      const { stdout } = runDiscoverJson(root);
      expect(stdout).toBe(expected);
    } finally {
      await removeTree(temporary);
    }
  });
});
