import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

interface CompositeStep {
  readonly name?: string;
  readonly run?: string;
  readonly shell?: string;
}

interface ActionYaml {
  readonly inputs: Record<string, { required?: boolean; default?: string }>;
  readonly runs: {
    readonly using: string;
    readonly steps: readonly CompositeStep[];
  };
}

const actionYamlPath = fileURLToPath(new URL("../../action.yml", import.meta.url));
const action = parse(readFileSync(actionYamlPath, "utf8")) as ActionYaml;

describe("action.yml", () => {
  it("is a composite action", () => {
    expect(action.runs.using).toBe("composite");
  });

  it("declares command as a required input", () => {
    expect(action.inputs["command"]?.required).toBe(true);
  });

  it("never interpolates a GitHub Actions expression inside a run: script", () => {
    // Inputs must reach shell steps only via `env:`-mapped INPUT_* variables
    // (referenced in bash as $INPUT_*), never via direct `${{ inputs.* }}`
    // substitution into the script body -- the standard GitHub Actions
    // script-injection footgun. See ADR-0016.
    for (const step of action.runs.steps) {
      if (step.run === undefined) continue;
      expect(step.run.includes("${{")).toBe(false);
    }
  });

  it("only uses bash for its run steps", () => {
    for (const step of action.runs.steps) {
      if (step.run === undefined) continue;
      expect(step.shell).toBe("bash");
    }
  });
});
