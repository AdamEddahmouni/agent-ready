import { describe, expect, it } from "vitest";
import { normalizeContract } from "../../src/contract/normalize.js";
import type { RawContract } from "../../src/contract/types.js";
import { planGeneration, resolvePlannedOutputs } from "../../src/generate/generate.js";
import { renderAgentsMd } from "../../src/generate/adapters/agentsMd.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";

const baseRaw: RawContract = {
  version: 1,
  project: { name: "example" },
  adapters: {
    agentsMd: { enabled: true },
    claude: { enabled: true },
    cursor: { enabled: true },
    copilot: { enabled: true },
    gemini: { enabled: true },
  },
};

describe("planGeneration", () => {
  it("produces an entry per enabled, implemented adapter", () => {
    const contract = normalizeContract(baseRaw);
    const plan = planGeneration(contract, "/repo");
    expect(plan.diagnostics).toEqual([]);
    expect(plan.entries.map((e) => e.adapter).sort()).toEqual([
      "agentsMd",
      "claude",
      "copilot",
      "cursor",
      "gemini",
    ]);
    expect(plan.entries.map((e) => e.relativePath).sort()).toEqual([
      ".cursorrules",
      ".github/copilot-instructions.md",
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
    ]);
    for (const entry of plan.entries) {
      expect(entry.absolutePath).toBe(`/repo/${entry.relativePath}`);
    }
  });

  it("produces no entry for a disabled adapter", () => {
    const contract = normalizeContract({
      ...baseRaw,
      adapters: { agentsMd: { enabled: false }, claude: { enabled: true } },
    });
    const plan = planGeneration(contract, "/repo");
    expect(plan.entries.map((e) => e.adapter)).toEqual(["claude"]);
  });

  // As of this phase, every declared `AdapterName` (agentsMd, claude, cursor,
  // copilot, gemini) has a registered renderer, so ADAPTER_NOT_YET_IMPLEMENTED
  // is unreachable through the normal contract pipeline (the schema already
  // rejects unrecognized adapter keys before planGeneration runs). The
  // diagnostic code and this handling path stay in place for the next time a
  // new adapter name is added to AdapterName ahead of its renderer.

  it("produces no entries and no diagnostics when no adapters are declared", () => {
    const contract = normalizeContract({ version: 1, project: { name: "example" } });
    const plan = planGeneration(contract, "/repo");
    expect(plan.entries).toEqual([]);
    expect(plan.diagnostics).toEqual([]);
  });

  it("handles a root with a long run of trailing path separators", () => {
    const contract = normalizeContract(baseRaw);
    const repoRoot = `/repo${"/".repeat(10_000)}`;
    const plan = planGeneration(contract, repoRoot);

    expect(plan.diagnostics).toEqual([]);
    expect(plan.entries).toHaveLength(5);
  });
});

describe("resolvePlannedOutputs", () => {
  it("marks a nonexistent target as would-write", async () => {
    const contract = normalizeContract(baseRaw);
    const plan = planGeneration(contract, "/repo");
    const fs = new InMemoryFileSystem("/repo");
    const outputs = await resolvePlannedOutputs(fs, plan.entries);
    expect(outputs.every((o) => o.status === "would-write")).toBe(true);
  });

  it("marks a target with identical content as up-to-date", async () => {
    const contract = normalizeContract(baseRaw);
    const plan = planGeneration(contract, "/repo");
    const fs = new InMemoryFileSystem("/repo");
    for (const entry of plan.entries) {
      fs.addFile(entry.absolutePath, entry.content);
    }
    const outputs = await resolvePlannedOutputs(fs, plan.entries);
    expect(outputs.every((o) => o.status === "up-to-date")).toBe(true);
  });

  it("marks a managed target with stale content as would-write", async () => {
    const contract = normalizeContract(baseRaw);
    const plan = planGeneration(contract, "/repo");
    const fs = new InMemoryFileSystem("/repo");
    const target = plan.entries.find((e) => e.relativePath === "AGENTS.md");
    if (target === undefined) throw new Error("expected AGENTS.md entry");
    fs.addFile(target.absolutePath, renderAgentsMd(contract).content + "\nstale trailing line\n");
    const outputs = await resolvePlannedOutputs(fs, [target]);
    expect(outputs[0]?.status).toBe("would-write");
  });

  it("marks an existing file without the marker as unmanaged", async () => {
    const contract = normalizeContract(baseRaw);
    const plan = planGeneration(contract, "/repo");
    const fs = new InMemoryFileSystem("/repo");
    const target = plan.entries.find((e) => e.relativePath === "AGENTS.md");
    if (target === undefined) throw new Error("expected AGENTS.md entry");
    fs.addFile(target.absolutePath, "# Hand-written AGENTS.md\n");
    const outputs = await resolvePlannedOutputs(fs, [target]);
    expect(outputs[0]?.status).toBe("unmanaged");
  });
});
