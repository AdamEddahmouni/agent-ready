import { describe, expect, it } from "vitest";
import { normalizeContract } from "../../src/contract/normalize.js";
import type { RawContract } from "../../src/contract/types.js";

describe("normalizeContract", () => {
  it("resolves defaults for a minimal contract", () => {
    const result = normalizeContract({ version: 1, project: { name: "example" } });
    expect(result).toEqual({
      version: 1,
      project: { name: "example" },
      environment: { runtimes: [] },
      commands: [],
      verification: { required: [] },
      paths: { protected: [], generated: [], ignored: [] },
      instructions: { sources: [] },
      adapters: [],
    });
  });

  it("sorts commands alphabetically regardless of declaration order", () => {
    const raw: RawContract = {
      version: 1,
      project: { name: "example" },
      commands: {
        test: { run: "pnpm test" },
        build: { run: "pnpm build" },
        lint: { run: "pnpm lint" },
      },
    };
    const result = normalizeContract(raw);
    expect(result.commands.map((c) => c.name)).toEqual(["build", "lint", "test"]);
  });

  it("preserves the declared order of verification.required", () => {
    const raw: RawContract = {
      version: 1,
      project: { name: "example" },
      commands: { build: { run: "x" }, test: { run: "y" }, lint: { run: "z" } },
      verification: { required: ["test", "build", "lint"] },
    };
    const result = normalizeContract(raw);
    expect(result.verification.required).toEqual(["test", "build", "lint"]);
  });

  it("sorts path categories alphabetically", () => {
    const raw: RawContract = {
      version: 1,
      project: { name: "example" },
      paths: { ignored: ["node_modules/**", "dist/**"] },
    };
    const result = normalizeContract(raw);
    expect(result.paths.ignored).toEqual(["dist/**", "node_modules/**"]);
  });

  it("preserves declared order of instruction sources", () => {
    const raw: RawContract = {
      version: 1,
      project: { name: "example" },
      instructions: { sources: ["docs/b.md", "docs/a.md"] },
    };
    const result = normalizeContract(raw);
    expect(result.instructions.sources).toEqual(["docs/b.md", "docs/a.md"]);
  });

  it("sorts adapters alphabetically and only includes declared ones", () => {
    const raw: RawContract = {
      version: 1,
      project: { name: "example" },
      adapters: { claude: { enabled: true }, agentsMd: { enabled: false } },
    };
    const result = normalizeContract(raw);
    expect(result.adapters).toEqual([
      { name: "agentsMd", enabled: false },
      { name: "claude", enabled: true },
    ]);
  });

  it("sorts runtimes alphabetically", () => {
    const raw: RawContract = {
      version: 1,
      project: { name: "example" },
      environment: { runtimes: { python: ">=3.11", node: ">=20" } },
    };
    const result = normalizeContract(raw);
    expect(result.environment.runtimes.map((r) => r.name)).toEqual(["node", "python"]);
  });

  it("produces identical output for equivalent contracts regardless of key order", () => {
    const a = normalizeContract({
      version: 1,
      project: { name: "example" },
      commands: { build: { run: "x" }, lint: { run: "y" } },
    });
    const b = normalizeContract({
      version: 1,
      project: { name: "example" },
      commands: { lint: { run: "y" }, build: { run: "x" } },
    });
    expect(a).toEqual(b);
  });
});
