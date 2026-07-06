import { describe, expect, it } from "vitest";
import { runExplain } from "../../src/cli/commands/explain.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";
import { DIAGNOSTIC_CODES } from "../../src/diagnostics/codes.js";
import { EXPLANATION_REGISTRY } from "../../src/cli/commands/explainRegistry.js";

function minimalFs(): InMemoryFileSystem {
  const fs = new InMemoryFileSystem("/repo");
  fs.addFile("/repo/agent-ready.yaml", "version: 1\nproject:\n  name: test\n");
  return fs;
}

describe("runExplain", () => {
  describe("unknown --code", () => {
    it("exits 1 with a human error on stderr", async () => {
      const fs = new InMemoryFileSystem("/repo");
      const outcome = await runExplain(fs, { json: false, code: "BOGUS_CODE" });
      expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
      expect(outcome.stderr).toContain("unknown diagnostic code");
      expect(outcome.stderr).toContain("BOGUS_CODE");
    });
  });

  describe("valid code — no --config", () => {
    it("renders human output with what/why/fix sections", async () => {
      const fs = new InMemoryFileSystem("/repo");
      const outcome = await runExplain(fs, {
        json: false,
        code: "CONTRACT_NOT_FOUND",
      });
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      expect(outcome.stdout).toContain("agent-ready explain CONTRACT_NOT_FOUND");
      expect(outcome.stdout).toContain("What it means:");
      expect(outcome.stdout).toContain("Why it happens:");
      expect(outcome.stdout).toContain("How to fix it:");
    });

    it("renders JSON envelope with expected fields", async () => {
      const fs = new InMemoryFileSystem("/repo");
      const outcome = await runExplain(fs, {
        json: true,
        code: "PACKAGE_MANAGER_UNAVAILABLE",
      });
      expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
      const body = JSON.parse(outcome.stdout) as Record<string, unknown>;
      expect(body["ok"]).toBe(true);
      expect(body["code"]).toBe("PACKAGE_MANAGER_UNAVAILABLE");
      expect(body["severity"]).toBe("error");
      expect(typeof body["what"]).toBe("string");
      expect(typeof body["why"]).toBe("string");
      expect(typeof body["fix"]).toBe("string");
      expect(body["diagnostics"]).toEqual([]);
    });

    it("includes related codes when present", async () => {
      const fs = new InMemoryFileSystem("/repo");
      const outcome = await runExplain(fs, {
        json: true,
        code: "PROTECTED_PATH_MODIFIED",
      });
      const body = JSON.parse(outcome.stdout) as { related: string[] };
      expect(body.related).toContain("GIT_UNAVAILABLE");
    });

    it("reports warning severity for warning-level codes", async () => {
      const fs = new InMemoryFileSystem("/repo");
      const outcome = await runExplain(fs, {
        json: true,
        code: "ADAPTER_NOT_YET_IMPLEMENTED",
      });
      const body = JSON.parse(outcome.stdout) as { severity: string };
      expect(body.severity).toBe("warning");
    });
  });

  describe("with --config", () => {
    it("includes contractFields when the code has field relationships", async () => {
      const fs = minimalFs();
      const outcome = await runExplain(fs, {
        json: true,
        code: "CONTRACT_VERSION_UNSUPPORTED",
        config: "/repo/agent-ready.yaml",
      });
      const body = JSON.parse(outcome.stdout) as {
        ok: boolean;
        contractPath: string;
        repoRoot: string;
        contractFields: { field: string; value: number }[];
      };
      expect(body.ok).toBe(true);
      expect(body.contractPath).toBe("/repo/agent-ready.yaml");
      expect(body.repoRoot).toBe("/repo");
      expect(body.contractFields).toHaveLength(1);
      expect(body.contractFields[0]?.field).toBe("/version");
      expect(body.contractFields[0]?.value).toBe(1);
    });

    it("includes human 'Your contract' section when --config loads", async () => {
      const fs = minimalFs();
      const outcome = await runExplain(fs, {
        json: false,
        code: "CONTRACT_VERSION_UNSUPPORTED",
        config: "/repo/agent-ready.yaml",
      });
      expect(outcome.stdout).toContain("Your contract (/repo/agent-ready.yaml)");
      expect(outcome.stdout).toContain("/version");
    });

    it("includes explanation even when contract load fails", async () => {
      const fs = new InMemoryFileSystem("/repo");
      const outcome = await runExplain(fs, {
        json: true,
        code: "CONTRACT_NOT_FOUND",
        config: "/repo/agent-ready.yaml",
      });
      expect(outcome.exitCode).toBe(ExitCode.CONTRACT_NOT_FOUND);
      const body = JSON.parse(outcome.stdout) as Record<string, unknown>;
      expect(body["ok"]).toBe(false);
      expect(body["code"]).toBe("CONTRACT_NOT_FOUND");
      const diags = body["diagnostics"] as { code: string }[];
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0]?.code).toBe("CONTRACT_NOT_FOUND");
    });

    it("exits 2 when --config path does not exist", async () => {
      const fs = new InMemoryFileSystem("/repo");
      const outcome = await runExplain(fs, {
        json: false,
        code: "CONTRACT_NOT_FOUND",
        config: "/repo/nosuch.yaml",
      });
      expect(outcome.exitCode).toBe(ExitCode.CONTRACT_NOT_FOUND);
    });
  });

  describe("registry invariant", () => {
    it("every DIAGNOSTIC_CODES entry has an EXPLANATION_REGISTRY entry", () => {
      for (const code of DIAGNOSTIC_CODES) {
        expect(EXPLANATION_REGISTRY.has(code), `Missing explanation for ${code}`).toBe(true);
      }
    });

    it("EXPLANATION_REGISTRY has no extra keys beyond DIAGNOSTIC_CODES", () => {
      const codeSet = new Set<string>(DIAGNOSTIC_CODES);
      for (const key of EXPLANATION_REGISTRY.keys()) {
        expect(codeSet.has(key), `Extra registry key: ${key}`).toBe(true);
      }
    });
  });
});
