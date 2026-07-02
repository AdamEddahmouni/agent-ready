import type { NormalizedContract } from "../../contract/types.js";
import { escapeMarkdownText } from "./escape.js";
import { GENERATED_FILE_MARKER } from "../marker.js";
import type { GeneratedFile } from "../types.js";
import { renderContractSections } from "./shared.js";

/** Renders the `gemini` adapter's output: `GEMINI.md`. */
export function renderGemini(contract: NormalizedContract): GeneratedFile {
  const content =
    [
      GENERATED_FILE_MARKER,
      "",
      `# GEMINI.md — ${escapeMarkdownText(contract.project.name)}`,
      "",
      renderContractSections(contract),
    ].join("\n") + "\n";

  return { relativePath: "GEMINI.md", content };
}
