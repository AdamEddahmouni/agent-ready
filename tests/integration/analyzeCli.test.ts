import { describe, expect, it } from "vitest";
import { runAnalyze } from "../../src/cli/commands/analyze.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import { createTestRepo } from "./testRepo.js";

describe("agent-ready analyze (CLI composition)", () => {
  it("reports checked source and link counts on success", async () => {
    const repo = await createTestRepo({
      "agent-ready.yaml": [
        "version: 1",
        "project:",
        "  name: docs-example",
        "instructions:",
        "  sources:",
        "    - README.md",
        "",
      ].join("\n"),
      "README.md": "See [the guide](docs/guide.md).\n",
      "docs/guide.md": "# Guide\n",
    });
    try {
      const outcome = await runAnalyze(new NodeFileSystem(), { json: false }, repo.root);
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      expect(outcome.stdout).toContain("No documentation drift found.");
      expect(outcome.stdout).toContain("instruction sources checked: 1");
      expect(outcome.stdout).toContain("local links checked: 1");
    } finally {
      await repo.cleanup();
    }
  });

  it("returns structured broken-link findings in JSON", async () => {
    const repo = await createTestRepo({
      "agent-ready.yaml": [
        "version: 1",
        "project:",
        "  name: docs-example",
        "instructions:",
        "  sources:",
        "    - README.md",
        "",
      ].join("\n"),
      "README.md": "See [the missing guide](docs/missing.md).\n",
    });
    try {
      const outcome = await runAnalyze(new NodeFileSystem(), { json: true }, repo.root);
      expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
      const body = JSON.parse(outcome.stdout) as {
        ok: boolean;
        linksChecked: number;
        findings: { kind: string; resolvedPath: string }[];
        diagnostics: { code: string }[];
      };
      expect(body.ok).toBe(false);
      expect(body.linksChecked).toBe(1);
      expect(body.findings).toEqual([
        expect.objectContaining({ kind: "broken", resolvedPath: "docs/missing.md" }),
      ]);
      expect(body.diagnostics[0]?.code).toBe("DOCUMENTATION_LINK_BROKEN");
    } finally {
      await repo.cleanup();
    }
  });

  it("succeeds with zero counts when no instruction sources are declared", async () => {
    const repo = await createTestRepo({
      "agent-ready.yaml": "version: 1\nproject:\n  name: no-docs\n",
    });
    try {
      const outcome = await runAnalyze(new NodeFileSystem(), { json: true }, repo.root);
      const body = JSON.parse(outcome.stdout) as {
        ok: boolean;
        sources: unknown[];
        linksChecked: number;
      };
      expect(body).toMatchObject({ ok: true, sources: [], linksChecked: 0 });
    } finally {
      await repo.cleanup();
    }
  });
});
