import type { NormalizedContract } from "../../contract/types.js";
import { escapeMarkdownText } from "./escape.js";
import { GENERATED_FILE_MARKER } from "../marker.js";
import type { GeneratedFile } from "../types.js";
import { renderContractSections } from "./shared.js";

/** Renders the `copilot` adapter's output: `.github/copilot-instructions.md`. */
export function renderCopilot(contract: NormalizedContract): GeneratedFile {
  const content =
    [
      GENERATED_FILE_MARKER,
      "",
      `# GitHub Copilot instructions — ${escapeMarkdownText(contract.project.name)}`,
      "",
      renderContractSections(contract),
    ].join("\n") + "\n";

  return { relativePath: ".github/copilot-instructions.md", content };
}
