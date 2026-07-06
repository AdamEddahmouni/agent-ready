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

const groupingRaw: RawContract = {
  version: 1,
  project: { name: "grouping-example" },
  commands: {
    build: { run: "tsc" },
    typecheck: { run: "tsc --noEmit" },
    lint: { run: "eslint ." },
    format: { run: "prettier --check ." },
    test: { run: "vitest" },
    "test-e2e": { run: "playwright test" },
    ci: { run: "pnpm ci" },
    custom: { run: "node custom.js" },
  },
  verification: { required: ["lint", "test", "build"] },
  adapters: { agentsMd: { enabled: true } },
};

const verificationRaw: RawContract = {
  version: 1,
  project: { name: "verify-example" },
  commands: {
    lint: { run: "eslint ." },
    test: { run: "vitest", description: "Run all tests" },
    build: { run: "tsc" },
  },
  verification: { required: ["lint", "test", "build"] },
  adapters: { agentsMd: { enabled: true } },
};

const pathsRaw: RawContract = {
  version: 1,
  project: { name: "paths-example" },
  paths: {
    protected: [".env*", "config/**"],
    generated: ["dist/**", "coverage/**"],
    ignored: ["node_modules/**"],
  },
  adapters: { agentsMd: { enabled: true } },
};

const envRaw: RawContract = {
  version: 1,
  project: { name: "env-example" },
  environment: {
    runtimes: { node: ">=20 <23" },
    packageManager: { name: "pnpm", version: "10" },
  },
  adapters: { agentsMd: { enabled: true } },
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
    // Empty sections (Environment, Path Rules) are omitted entirely
    // when no data is declared, keeping output lean.
    expect(file.content).not.toContain("## Environment");
    expect(file.content).not.toContain("## Path Rules");
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

  it("groups commands into well-known categories", () => {
    const contract = normalizeContract(groupingRaw);
    const file = render(contract);
    expect(file.content).toContain("### Build & Typecheck");
    expect(file.content).toContain("### Code Quality");
    expect(file.content).toContain("### Testing");
    expect(file.content).toContain("### CI / Automation");
    expect(file.content).toContain("### Other Commands");
  });

  it("renders verification as a numbered pipeline", () => {
    const contract = normalizeContract(verificationRaw);
    const file = render(contract);
    expect(file.content).toContain("1. **`lint`**");
    expect(file.content).toContain("2. **`test`** — Run all tests");
    expect(file.content).toContain("3. **`build`**");
    expect(file.content).toContain("Run verification with: `agent-ready verify --execute`");
  });

  it("renders Before Submitting Work checklist when verification is required", () => {
    const contract = normalizeContract(verificationRaw);
    const file = render(contract);
    expect(file.content).toContain("## Before Submitting Work");
    expect(file.content).toContain("- Run `eslint .`");
    expect(file.content).toContain("- Run `vitest`");
    expect(file.content).toContain("- Run `tsc`");
  });

  it("omits Before Submitting Work when no verification is required", () => {
    const contract = normalizeContract(minimalRaw);
    const file = render(contract);
    expect(file.content).not.toContain("## Before Submitting Work");
  });

  it("renders Path Rules with explanatory sub-sections", () => {
    const contract = normalizeContract(pathsRaw);
    const file = render(contract);
    expect(file.content).toContain("### Protected (DO NOT modify without explicit approval)");
    expect(file.content).toContain("### Generated (produced by build, do not hand-edit)");
    expect(file.content).toContain("### Ignored (do not include in agent output or consideration)");
  });

  it("renders Environment section when runtime data is present", () => {
    const contract = normalizeContract(envRaw);
    const file = render(contract);
    expect(file.content).toContain("## Environment");
    expect(file.content).toContain("**node**: `>=20 <23`");
    expect(file.content).toContain("**Package manager**: `pnpm@10`");
  });

  it("uses Further Context heading instead of Further instructions", () => {
    const contract = normalizeContract(minimalRaw);
    const file = render(contract);
    expect(file.content).toContain("## Further Context");
    expect(file.content).not.toContain("## Further instructions");
  });
});
