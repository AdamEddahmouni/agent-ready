import type { NormalizedContract } from "../../contract/types.js";
import { escapeMarkdownText } from "./escape.js";
import { GENERATED_FILE_MARKER } from "../marker.js";
import type { GeneratedFile } from "../types.js";
import { renderContractSections } from "./shared.js";

/** Renders the `claude` adapter's output: `CLAUDE.md`. */
export function renderClaude(contract: NormalizedContract): GeneratedFile {
  const content =
    [
      GENERATED_FILE_MARKER,
      "",
      `# CLAUDE.md — ${escapeMarkdownText(contract.project.name)}`,
      "",
      renderContractSections(contract),
    ].join("\n") + "\n";

  return { relativePath: "CLAUDE.md", content };
}
