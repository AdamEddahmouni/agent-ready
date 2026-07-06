import { describe, expect, it } from "vitest";
import { runSchema } from "../../src/cli/commands/schema.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";

describe("agent-ready schema (CLI composition)", () => {
  it("reads the real bundled schema via import.meta.url resolution (no override)", async () => {
    const outcome = await runSchema({ json: false, content: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("Agent-Ready contract JSON Schema (bundled with this CLI).");
    expect(outcome.stdout).toContain("contract version: 1");
    expect(outcome.stdout).toContain(
      "JSON Schema $schema: https://json-schema.org/draft/2020-12/schema",
    );
    expect(outcome.stdout).toContain(
      "JSON Schema $id: https://schemas.agent-ready.dev/v1/agent-ready.schema.json",
    );
    expect(outcome.stdout).toContain("title: Agent-Ready Repository Contract");
  });

  it("returns a structured --json envelope from the real bundled schema", async () => {
    const outcome = await runSchema({ json: true, content: false });
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
    };
    expect(body.ok).toBe(true);
    // OS-tolerant: forward slash on POSIX, backslash on Windows.
    expect(body.schemaPath).toMatch(/schemas[/\\]v1[/\\]agent-ready\.schema\.json$/);
    expect(body.contractVersion).toBe(1);
    expect(body.draft).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(body.id).toBe("https://schemas.agent-ready.dev/v1/agent-ready.schema.json");
    expect(body.title.toLowerCase()).toContain("agent-ready repository contract");
    expect(body.byteCount).toBeGreaterThan(1000);
    expect(body.diagnostics).toEqual([]);
  });

  it("includes the real schema body when --content", async () => {
    const outcome = await runSchema({ json: true, content: true });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const body = JSON.parse(outcome.stdout) as {
      schema: {
        $id: string;
        additionalProperties: boolean;
        required: string[];
        properties: Record<string, unknown>;
      };
    };
    expect(body.schema.$id).toBe("https://schemas.agent-ready.dev/v1/agent-ready.schema.json");
    expect(body.schema.additionalProperties).toBe(false);
    expect(body.schema.required).toEqual(["version", "project"]);
    expect(body.schema.properties).toHaveProperty("version");
    expect(body.schema.properties).toHaveProperty("project");
    expect(body.schema.properties).toHaveProperty("commands");
  });

  it("does not require a contract file or repo context", async () => {
    // Plain invocation with no FileSystem, no startDir, no options.schemaPath
    // — the schema command depends only on the package's own bundled schema
    // and the running Node process; it must succeed without any repository
    // preconditions. There is intentionally no testRepo setup here.
    const outcome = await runSchema({ json: false, content: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });
});
