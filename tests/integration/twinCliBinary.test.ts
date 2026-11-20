/**
 * The twin surface must work from any working directory: a consumer runs the
 * installed CLI from their own project, not from the package root. The bundled
 * Discovery Snapshot Format 1 schema is resolved relative to the compiled
 * module, so this pins that independently of `pnpm test`'s cwd.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(repoRoot, "dist/cli/index.js");

describe("built CLI twin outside the package root", () => {
  it.skipIf(!existsSync(cli))("builds and queries a snapshot from an unrelated cwd", () => {
    const temporary = mkdtempSync(join(tmpdir(), "agent-ready-twin-cwd-"));
    try {
      const fixture = join(temporary, "fixture");
      mkdirSync(join(fixture, "src"), { recursive: true });
      writeFileSync(
        join(fixture, "package.json"),
        `${JSON.stringify(
          { name: "twin-cwd-fixture", version: "0.0.0", scripts: { test: "vitest run" } },
          null,
          2,
        )}\n`,
      );
      writeFileSync(join(fixture, "src/index.ts"), "export const value = 1;\n");
      const snapshot = join(temporary, "snapshot.json");

      execFileSync(
        process.execPath,
        [cli, "twin", "build", "--root", fixture, "--output", snapshot],
        { cwd: temporary, encoding: "utf8" },
      );
      expect(existsSync(snapshot)).toBe(true);

      const queried = execFileSync(
        process.execPath,
        [cli, "twin", "query", "--snapshot", snapshot, "--kind", "summary", "--json"],
        { cwd: temporary, encoding: "utf8" },
      );
      const body = JSON.parse(queried) as { kind?: unknown; queryVersion?: unknown };
      expect(body.queryVersion).toBe(1);
      expect(body.kind).toBe("summary");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
