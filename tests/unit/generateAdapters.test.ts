import { describe, expect, it } from "vitest";
import { normalizeContract } from "../../src/contract/normalize.js";
import type { RawContract } from "../../src/contract/types.js";
import { renderAgentsMd } from "../../src/generate/adapters/agentsMd.js";
import { renderClaude } from "../../src/generate/adapters/claude.js";
import { renderCopilot } from "../../src/generate/adapters/copilot.js";
import { renderCursor } from "../../src/generate/adapters/cursor.js";
import { renderGemini } from "../../src/generate/adapters/gemini.js";
import { GENERATED_FILE_MARKER, hasManagedMarker } from "../../src/generate/marker.js";

const minimalRaw: RawContract = { version: 1, project: { name: "example" } };

const fullRaw: RawContract = {
  version: 1,
  project: { name: "full-example", description: "A fully populated contract." },
  environment: {
    runtimes: { node: ">=20 <23" },
    packageManager: { name: "pnpm", version: "10" },
  },
  commands: {
    lint: { run: "pnpm lint" },
    test: { run: "pnpm test", description: "Runs the test suite." },
  },
  verification: { required: ["lint", "test"] },
  paths: {
    protected: [".env*"],
    generated: ["dist/**"],
    ignored: ["node_modules/**"],
  },
  instructions: { sources: [] },
  adapters: { agentsMd: { enabled: true }, claude: { enabled: true } },
};

describe.each([
  { name: "agentsMd", render: renderAgentsMd, relativePath: "AGENTS.md" },
  { name: "claude", render: renderClaude, relativePath: "CLAUDE.md" },
  { name: "cursor", render: renderCursor, relativePath: ".cursorrules" },
  {
    name: "copilot",
    render: renderCopilot,
    relativePath: ".github/copilot-instructions.md",
  },
  { name: "gemini", render: renderGemini, relativePath: "GEMINI.md" },
])("$name adapter renderer", ({ render, relativePath }) => {
  it("targets the expected file name", () => {
    const contract = normalizeContract(minimalRaw);
    expect(render(contract).relativePath).toBe(relativePath);
  });

  it("embeds the managed-file marker", () => {
    const contract = normalizeContract(minimalRaw);
    const file = render(contract);
    expect(hasManagedMarker(file.content)).toBe(true);
    expect(file.content).toContain(GENERATED_FILE_MARKER);
  });

  it("renders sensible defaults for a minimal contract with empty sections", () => {
    const contract = normalizeContract(minimalRaw);
    const file = render(contract);
    expect(file.content).toContain("example");
    expect(file.content).toContain("(none declared)");
    expect(file.content).toContain("(none required)");
    expect(file.content).toContain("(none)");
  });

  it("renders every declared section for a fully populated contract", () => {
    const contract = normalizeContract(fullRaw);
    const file = render(contract);
    expect(file.content).toContain("full-example");
    expect(file.content).toContain("A fully populated contract.");
    expect(file.content).toContain("node");
    expect(file.content).toContain(">=20 <23");
    expect(file.content).toContain("pnpm@10");
    expect(file.content).toContain("pnpm lint");
    expect(file.content).toContain("pnpm test");
    expect(file.content).toContain("Runs the test suite.");
    expect(file.content).toContain("`lint`");
    expect(file.content).toContain(".env*");
    expect(file.content).toContain("dist/**");
    expect(file.content).toContain("node_modules/**");
  });

  it("is deterministic across repeated renders", () => {
    const contract = normalizeContract(fullRaw);
    expect(render(contract).content).toBe(render(contract).content);
  });
});
