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
      expect(outcome.exitCode, outcome.stdout || outcome.stderr).toBe(ExitCode.SUCCESS);
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

  it("checks declared architecture decisions and agent context files", async () => {
    const repo = await createTestRepo({
      "agent-ready.yaml": [
        "version: 1",
        "project:",
        "  name: rich-context",
        "architecture:",
        "  key_decisions:",
        "    - file: docs/decisions/0001.md",
        "      summary: Use ESM.",
        "agents:",
        "  context_files:",
        "    - docs/context.md",
        "",
      ].join("\n"),
      "docs/decisions/0001.md": "# Decision\n",
      "docs/context.md": "# Context\n",
    });
    try {
      const outcome = await runAnalyze(new NodeFileSystem(), { json: true }, repo.root);
      expect(outcome.exitCode, outcome.stdout || outcome.stderr).toBe(ExitCode.SUCCESS);
      const body = JSON.parse(outcome.stdout) as {
        declaredFiles: { kind: string; path: string; exists: boolean }[];
      };
      expect(body.declaredFiles).toEqual([
        { kind: "architecture-decision", path: "docs/decisions/0001.md", exists: true },
        { kind: "agent-context", path: "docs/context.md", exists: true },
      ]);
    } finally {
      await repo.cleanup();
    }
  });

  it("checks boundary rules against the import graph only when --architecture is passed", async () => {
    const repo = await createTestRepo({
      "agent-ready.yaml": [
        "version: 1",
        "project:",
        "  name: boundary-example",
        "architecture:",
        "  boundary_rules:",
        "    - from: src/contract",
        "      must_not_import:",
        "        - src/cli",
        "",
      ].join("\n"),
      "src/contract/pipeline.ts": 'import { render } from "../cli/render.js";\n',
      "src/cli/render.ts": "export const render = () => {};\n",
    });
    try {
      const withoutFlag = await runAnalyze(new NodeFileSystem(), { json: false }, repo.root);
      expect(withoutFlag.exitCode, withoutFlag.stderr).toBe(ExitCode.SUCCESS);
      expect(withoutFlag.stdout).not.toContain("boundary");

      const withFlag = await runAnalyze(
        new NodeFileSystem(),
        { json: false, architecture: true },
        repo.root,
      );
      expect(withFlag.exitCode).not.toBe(ExitCode.SUCCESS);
      expect(withFlag.stderr).toContain("ARCHITECTURE_BOUNDARY_VIOLATED");
      expect(withFlag.stderr).toContain("src/contract/pipeline.ts");
    } finally {
      await repo.cleanup();
    }
  });

  it("reports boundary scan counts and findings in JSON", async () => {
    const repo = await createTestRepo({
      "agent-ready.yaml": [
        "version: 1",
        "project:",
        "  name: boundary-json",
        "architecture:",
        "  boundary_rules:",
        "    - from: src/contract",
        "      must_not_import:",
        "        - src/cli",
        "",
      ].join("\n"),
      "src/contract/ok.ts": 'import { helper } from "./helper.js";\n',
      "src/contract/helper.ts": "export const helper = 1;\n",
    });
    try {
      const outcome = await runAnalyze(
        new NodeFileSystem(),
        { json: true, architecture: true },
        repo.root,
      );
      expect(outcome.exitCode, outcome.stdout).toBe(ExitCode.SUCCESS);
      const payload = JSON.parse(outcome.stdout) as {
        ok: boolean;
        architecture: {
          rules: { from: string; filesScanned: number; importsChecked: number }[];
          filesScanned: number;
          importsChecked: number;
          boundaryFindings: unknown[];
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.architecture.filesScanned).toBe(2);
      expect(payload.architecture.importsChecked).toBe(1);
      expect(payload.architecture.boundaryFindings).toEqual([]);
      expect(payload.architecture.rules[0]?.from).toBe("src/contract");
    } finally {
      await repo.cleanup();
    }
  });
});
