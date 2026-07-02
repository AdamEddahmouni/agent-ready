import { describe, expect, it } from "vitest";
import { normalizeContract } from "../../src/contract/normalize.js";
import type { RawContract } from "../../src/contract/types.js";
import { planGeneration, resolvePlannedOutputs } from "../../src/generate/generate.js";
import { renderAgentsMd } from "../../src/generate/adapters/agentsMd.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";

const baseRaw: RawContract = {
  version: 1,
  project: { name: "example" },
  adapters: { agentsMd: { enabled: true }, claude: { enabled: true } },
};

describe("planGeneration", () => {
  it("produces an entry per enabled, implemented adapter", () => {
    const contract = normalizeContract(baseRaw);
    const plan = planGeneration(contract, "/repo");
    expect(plan.diagnostics).toEqual([]);
    expect(plan.entries.map((e) => e.adapter).sort()).toEqual(["agentsMd", "claude"]);
    expect(plan.entries.map((e) => e.relativePath).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
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

  it("emits an ADAPTER_NOT_YET_IMPLEMENTED warning for an enabled adapter with no renderer", () => {
    const contract = normalizeContract({
      ...baseRaw,
      adapters: { cursor: { enabled: true } },
    });
    const plan = planGeneration(contract, "/repo");
    expect(plan.entries).toEqual([]);
    expect(plan.diagnostics).toHaveLength(1);
    expect(plan.diagnostics[0]).toMatchObject({
      code: "ADAPTER_NOT_YET_IMPLEMENTED",
      severity: "warning",
    });
  });

  it("produces no entries and no diagnostics when no adapters are declared", () => {
    const contract = normalizeContract({ version: 1, project: { name: "example" } });
    const plan = planGeneration(contract, "/repo");
    expect(plan.entries).toEqual([]);
    expect(plan.diagnostics).toEqual([]);
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
