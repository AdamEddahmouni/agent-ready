import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadContract } from "../../src/contract/pipeline.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";

const here = dirname(fileURLToPath(import.meta.url));
const examplesRoot = join(here, "..", "..", "examples");

describe("examples/minimal", () => {
  it("validates successfully", async () => {
    const result = await loadContract({
      fs: new NodeFileSystem(),
      startDir: join(examplesRoot, "minimal"),
    });
    expect(result.ok).toBe(true);
  });
});

describe("examples/complete-phase-1", () => {
  it("validates successfully and normalizes every field", async () => {
    const result = await loadContract({
      fs: new NodeFileSystem(),
      startDir: join(examplesRoot, "complete-phase-1"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contract.commands.map((c) => c.name)).toEqual([
        "build",
        "install",
        "lint",
        "test",
        "typecheck",
      ]);
      expect(result.value.contract.verification.required).toEqual([
        "lint",
        "typecheck",
        "test",
        "build",
      ]);
      expect(result.value.contract.adapters).toEqual([
        { name: "agentsMd", enabled: true },
        { name: "claude", enabled: true },
        { name: "copilot", enabled: true },
        { name: "cursor", enabled: true },
        { name: "gemini", enabled: true },
      ]);
    }
  });
});

describe("examples/adversarial-content", () => {
  it("validates successfully despite Markdown-significant content", async () => {
    const result = await loadContract({
      fs: new NodeFileSystem(),
      startDir: join(examplesRoot, "adversarial-content"),
    });
    expect(result.ok).toBe(true);
  });
});

describe("examples/invalid", () => {
  it("rejects unknown-field.yaml with CONTRACT_SCHEMA_INVALID", async () => {
    const result = await loadContract({
      fs: new NodeFileSystem(),
      explicitConfigPath: join(examplesRoot, "invalid", "unknown-field.yaml"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === "CONTRACT_SCHEMA_INVALID")).toBe(true);
    }
  });

  it("rejects invalid-command-reference.yaml with COMMAND_REFERENCE_INVALID", async () => {
    const result = await loadContract({
      fs: new NodeFileSystem(),
      explicitConfigPath: join(examplesRoot, "invalid", "invalid-command-reference.yaml"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === "COMMAND_REFERENCE_INVALID")).toBe(true);
    }
  });

  it("rejects invalid-path-traversal.yaml with PATH_TRAVERSAL_DISALLOWED", async () => {
    const result = await loadContract({
      fs: new NodeFileSystem(),
      explicitConfigPath: join(examplesRoot, "invalid", "invalid-path-traversal.yaml"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === "PATH_TRAVERSAL_DISALLOWED")).toBe(true);
    }
  });

  it("rejects unsupported-version.yaml with CONTRACT_VERSION_UNSUPPORTED", async () => {
    const result = await loadContract({
      fs: new NodeFileSystem(),
      explicitConfigPath: join(examplesRoot, "invalid", "unsupported-version.yaml"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === "CONTRACT_VERSION_UNSUPPORTED")).toBe(true);
    }
  });
});
