import type { NormalizedContract } from "../../contract/types.js";
import { GENERATED_FILE_MARKER } from "../marker.js";
import type { GeneratedFile } from "../types.js";
import { renderContractSections } from "./shared.js";

/** Renders the `agentsMd` adapter's output: `AGENTS.md`. */
export function renderAgentsMd(contract: NormalizedContract): GeneratedFile {
  const content =
    [
      GENERATED_FILE_MARKER,
      "",
      `# AGENTS.md — ${contract.project.name}`,
      "",
      renderContractSections(contract),
    ].join("\n") + "\n";

  return { relativePath: "AGENTS.md", content };
}
