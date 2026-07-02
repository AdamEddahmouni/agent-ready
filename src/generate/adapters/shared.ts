import type { NormalizedContract } from "../../contract/types.js";

/**
 * Renders the section body shared by every adapter's output. Adapters
 * wrap this with their own marker banner and title — kept as one plain
 * function (not a templating engine) since every adapter currently wants
 * the same information, just under a different heading.
 */
export function renderContractSections(contract: NormalizedContract): string {
  const lines: string[] = [];

  lines.push("## Project", "", contract.project.name);
  if (contract.project.description !== undefined) {
    lines.push("", contract.project.description);
  }

  lines.push("", "## Environment");
  if (
    contract.environment.runtimes.length === 0 &&
    contract.environment.packageManager === undefined
  ) {
    lines.push("", "(none declared)");
  } else {
    for (const runtime of contract.environment.runtimes) {
      lines.push("", `- Runtime \`${runtime.name}\`: \`${runtime.range}\``);
    }
    if (contract.environment.packageManager !== undefined) {
      lines.push(
        "",
        `- Package manager: \`${contract.environment.packageManager.name}@${contract.environment.packageManager.version}\``,
      );
    }
  }

  lines.push("", "## Commands");
  if (contract.commands.length === 0) {
    lines.push("", "(none declared)");
  } else {
    for (const command of contract.commands) {
      const description = command.description !== undefined ? ` — ${command.description}` : "";
      lines.push("", `- **${command.name}**: \`${command.run}\`${description}`);
    }
  }

  lines.push("", "## Verification");
  lines.push(
    "",
    contract.verification.required.length > 0
      ? `Required before considering work complete: ${contract.verification.required.map((name) => `\`${name}\``).join(", ")}.`
      : "(none required)",
  );

  lines.push("", "## Paths");
  lines.push("", `- Protected: ${formatPathList(contract.paths.protected)}`);
  lines.push("", `- Generated: ${formatPathList(contract.paths.generated)}`);
  lines.push("", `- Ignored: ${formatPathList(contract.paths.ignored)}`);

  lines.push("", "## Further instructions");
  if (contract.instructions.sources.length === 0) {
    lines.push("", "(none declared)");
  } else {
    lines.push("", "See the following files for more detail:");
    for (const source of contract.instructions.sources) {
      lines.push(`- [${source}](${source})`);
    }
  }

  return lines.join("\n");
}

function formatPathList(patterns: readonly string[]): string {
  return patterns.length > 0 ? patterns.map((pattern) => `\`${pattern}\``).join(", ") : "(none)";
}
