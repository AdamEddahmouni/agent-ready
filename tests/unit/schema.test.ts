import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runSchema } from "../../src/cli/commands/schema.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";

interface Fixture {
  readonly path: string;
  cleanup(): Promise<void>;
}

async function writeSchemaFixture(content: string, relativeDir = "schemas/v1"): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "agent-ready-schema-test-"));
  const path = join(root, relativeDir, "agent-ready.schema.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return { path, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const sample = JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.test/v1/agent-ready.schema.json",
    title: "Sample test schema (v1)",
  },
  null,
  2,
);

describe("runSchema (unit)", () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    if (fixture !== undefined) await fixture.cleanup();
    fixture = undefined;
  });

  describe("human output", () => {
    it("prints metadata-only summary by default", async () => {
      fixture = await writeSchemaFixture(sample);
      const outcome = await runSchema(
        { json: false, content: false },
        { schemaPath: fixture.path },
      );
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      expect(outcome.stdout).toContain("Agent-Ready contract JSON Schema (bundled with this CLI).");
      expect(outcome.stdout).toContain("contract version: 1");
      expect(outcome.stdout).toContain(`path: ${fixture.path}`);
      expect(outcome.stdout).toContain(
        "JSON Schema $schema: https://json-schema.org/draft/2020-12/schema",
      );
      expect(outcome.stdout).toContain(
        "JSON Schema $id: https://example.test/v1/agent-ready.schema.json",
      );
      expect(outcome.stdout).toContain("title: Sample test schema (v1)");
      // Body must not be in default output
      expect(outcome.stdout).not.toContain('"$id"');
    });

    it("appends pretty-printed schema body when --content", async () => {
      fixture = await writeSchemaFixture(sample);
      const outcome = await runSchema({ json: false, content: true }, { schemaPath: fixture.path });
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      expect(outcome.stdout).toContain("title: Sample test schema (v1)");
      expect(outcome.stdout).toContain('"$id": "https://example.test/v1/agent-ready.schema.json"');
      expect(outcome.stdout).toContain('"title": "Sample test schema (v1)"');
    });
  });

  describe("--json output", () => {
    it("emits structured metadata-only JSON by default", async () => {
      fixture = await writeSchemaFixture(sample);
      const outcome = await runSchema({ json: true, content: false }, { schemaPath: fixture.path });
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      const body = JSON.parse(outcome.stdout) as {
        ok: boolean;
        schemaPath: string;
        contractVersion: number;
        draft: string;
        id: string;
        title: string;
        byteCount: number;
        diagnostics: unknown[];
        schema?: unknown;
      };
      expect(body.ok).toBe(true);
      expect(body.schemaPath).toBe(fixture.path);
      expect(body.contractVersion).toBe(1);
      expect(body.draft).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(body.id).toBe("https://example.test/v1/agent-ready.schema.json");
      expect(body.title).toBe("Sample test schema (v1)");
      expect(body.byteCount).toBeGreaterThan(0);
      expect(body.diagnostics).toEqual([]);
      expect(body.schema).toBeUndefined();
    });

    it("includes the parsed schema as a 'schema' field with --content", async () => {
      fixture = await writeSchemaFixture(sample);
      const outcome = await runSchema({ json: true, content: true }, { schemaPath: fixture.path });
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      const body = JSON.parse(outcome.stdout) as { schema?: Record<string, unknown> };
      expect(body.schema).toMatchObject({
        $id: "https://example.test/v1/agent-ready.schema.json",
        title: "Sample test schema (v1)",
      });
      expect(body.schema).not.toHaveProperty("byteCount");
    });
  });

  describe("contract-version inference", () => {
    it("infers contractVersion=2 from a /schemas/v2/ path", async () => {
      fixture = await writeSchemaFixture(
        JSON.stringify({ $schema: "...", title: "v2" }),
        "schemas/v2",
      );
      const outcome = await runSchema({ json: true, content: false }, { schemaPath: fixture.path });
      expect(JSON.parse(outcome.stdout)).toMatchObject({
        ok: true,
        contractVersion: 2,
      });
    });

    it("falls back to contractVersion=1 when path does not match /schemas/vN/", async () => {
      fixture = await writeSchemaFixture(sample);
      // fixture path is /tmp/agent-ready-schema-test-XXX/schemas/v1/agent-ready.schema.json
      // — but we deliberately write a sibling file outside the v1 convention
      const root = await mkdtemp(join(tmpdir(), "agent-ready-schema-test-"));
      const path = join(root, "schema.json");
      await writeFile(path, JSON.stringify({ title: "no-version-segment" }), "utf8");
      fixture = { path, cleanup: () => rm(root, { recursive: true, force: true }) };
      const outcome = await runSchema({ json: true, content: false }, { schemaPath: fixture.path });
      expect(JSON.parse(outcome.stdout)).toMatchObject({
        ok: true,
        contractVersion: 1,
      });
    });
  });

  describe("error paths", () => {
    it("returns INTERNAL_ERROR on missing schema file", async () => {
      const outcome = await runSchema(
        { json: false, content: false },
        { schemaPath: "/definitely/does/not/exist/agent-ready.schema.json" },
      );
      expect(outcome.exitCode).toBe(ExitCode.INTERNAL_ERROR);
      expect(outcome.stderr).toContain("INTERNAL_INVARIANT_VIOLATION");
      expect(outcome.stderr).toContain("could not be read");
    });

    it("returns INTERNAL_ERROR on invalid JSON", async () => {
      fixture = await writeSchemaFixture("{ this is not valid JSON }");
      const outcome = await runSchema(
        { json: false, content: false },
        { schemaPath: fixture.path },
      );
      expect(outcome.exitCode).toBe(ExitCode.INTERNAL_ERROR);
      expect(outcome.stderr).toContain("INTERNAL_INVARIANT_VIOLATION");
      expect(outcome.stderr).toContain("not valid JSON");
    });

    it("returns INTERNAL_ERROR when JSON value is an array", async () => {
      fixture = await writeSchemaFixture("[]");
      const outcome = await runSchema(
        { json: false, content: false },
        { schemaPath: fixture.path },
      );
      expect(outcome.exitCode).toBe(ExitCode.INTERNAL_ERROR);
      expect(outcome.stderr).toContain("not a JSON object");
    });

    it("returns INTERNAL_ERROR when JSON value is null", async () => {
      fixture = await writeSchemaFixture("null");
      const outcome = await runSchema(
        { json: false, content: false },
        { schemaPath: fixture.path },
      );
      expect(outcome.exitCode).toBe(ExitCode.INTERNAL_ERROR);
      expect(outcome.stderr).toContain("not a JSON object");
    });

    it("returns INTERNAL_ERROR in JSON mode on missing schema file", async () => {
      const outcome = await runSchema(
        { json: true, content: false },
        { schemaPath: "/definitely/does/not/exist/agent-ready.schema.json" },
      );
      expect(outcome.exitCode).toBe(ExitCode.INTERNAL_ERROR);
      const body = JSON.parse(outcome.stdout) as {
        ok: boolean;
        diagnostics: { code: string }[];
      };
      expect(body.ok).toBe(false);
      expect(body.diagnostics[0]?.code).toBe("INTERNAL_INVARIANT_VIOLATION");
    });
  });
});
