import type { NormalizedContract } from "../../contract/types.js";
import { escapeMarkdownText } from "./escape.js";
import { GENERATED_FILE_MARKER } from "../marker.js";
import type { GeneratedFile } from "../types.js";
import { renderContractSections } from "./shared.js";

/** Renders the `cursor` adapter's output: `.cursorrules`. */
export function renderCursor(contract: NormalizedContract): GeneratedFile {
  const content =
    [
      GENERATED_FILE_MARKER,
      "",
      `# Cursor rules — ${escapeMarkdownText(contract.project.name)}`,
      "",
      renderContractSections(contract),
    ].join("\n") + "\n";

  return { relativePath: ".cursorrules", content };
}
