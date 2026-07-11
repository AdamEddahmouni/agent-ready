import type { NormalizedCommand, NormalizedContract } from "../../contract/types.js";
import { escapeMarkdownText, renderMarkdownLink, wrapCodeSpan } from "./escape.js";

/**
 * Renders the section body shared by every adapter's output. Adapters
 * wrap this with their own marker banner and title — kept as one plain
 * function (not a templating engine) since every adapter currently wants
 * the same information, just under a different heading.
 *
 * The output is designed to be maximally useful to AI coding agents:
 * commands are grouped by category, verification is presented as a
 * numbered pipeline, path rules include explanations of each category,
 * and a "Before committing" checklist ties it all together.
 */
export function renderContractSections(contract: NormalizedContract): string {
  const lines: string[] = [];

  // ── Project ────────────────────────────────────────────────────────
  lines.push("## Project", "", escapeMarkdownText(contract.project.name));
  if (contract.project.description !== undefined) {
    lines.push("", escapeMarkdownText(contract.project.description));
  }

  // ── Environment ────────────────────────────────────────────────────
  const hasEnv =
    contract.environment.runtimes.length > 0 || contract.environment.packageManager !== undefined;

  if (hasEnv) {
    lines.push("", "## Environment");
    lines.push(
      "",
      "This project targets the following runtime environment. Run `agent-ready doctor`",
      "to verify your local setup matches these declarations.",
    );

    for (const runtime of contract.environment.runtimes) {
      lines.push("", `- **${runtime.name}**: ${wrapCodeSpan(runtime.range)}`);
    }
    if (contract.environment.packageManager !== undefined) {
      lines.push(
        "",
        `- **Package manager**: ${wrapCodeSpan(
          `${contract.environment.packageManager.name}@${contract.environment.packageManager.version}`,
        )}`,
      );
    }
  }

  // ── Commands (grouped by category) ─────────────────────────────────
  if (contract.commands.length > 0) {
    const groups = groupCommands(contract.commands);

    lines.push("", "## Commands");
    lines.push(
      "",
      "Every command listed below is validated by `agent-ready validate`. If a",
      "command is modified or removed, the contract must be updated — the CLI",
      "will catch drift.",
    );

    for (const [label, cmds] of groups) {
      lines.push("", `### ${label}`);
      for (const cmd of cmds) {
        const description =
          cmd.description !== undefined ? ` — ${escapeMarkdownText(cmd.description)}` : "";
        lines.push(
          "",
          `- **\`${escapeMarkdownText(cmd.name)}\`**: ${wrapCodeSpan(cmd.run)}${description}`,
        );
      }
    }
  } else {
    lines.push("", "## Commands", "", "(none declared)");
  }

  // ── Verification pipeline ──────────────────────────────────────────
  lines.push("", "## Verification");
  if (contract.verification.required.length > 0) {
    lines.push(
      "",
      "Before considering any task complete, run these commands **in this order**.",
      "If any step fails, fix it before continuing. This order is declared in",
      "the contract and enforced by `agent-ready verify --execute`.",
    );

    for (let i = 0; i < contract.verification.required.length; i++) {
      const name = contract.verification.required[i] ?? "";
      const cmd = contract.commands.find((c) => c.name === name);
      const desc =
        cmd?.description !== undefined ? ` — ${escapeMarkdownText(cmd.description)}` : "";
      lines.push("", `${String(i + 1)}. **\`${escapeMarkdownText(name)}\`**${desc}`);
    }

    lines.push("", "Run verification with: `agent-ready verify --execute`");
  } else {
    lines.push("", "(none required)");
  }

  // ── Path rules ─────────────────────────────────────────────────────
  const hasPaths =
    contract.paths.protected.length > 0 ||
    contract.paths.generated.length > 0 ||
    contract.paths.ignored.length > 0;

  if (hasPaths) {
    lines.push("", "## Path Rules");
    lines.push(
      "",
      "These rules are **enforced** by `agent-ready check`. Violating them",
      "will fail CI. Patterns use the glob syntax documented in",
      "[path and glob semantics](docs/specification/paths-and-globs.md).",
    );

    if (contract.paths.protected.length > 0) {
      lines.push("", "### Protected (DO NOT modify without explicit approval)");
      lines.push("", "These files must never be changed by an AI coding agent:");
      for (const pattern of contract.paths.protected) {
        lines.push(`- ${wrapCodeSpan(pattern)}`);
      }
    }

    if (contract.paths.generated.length > 0) {
      lines.push("", "### Generated (produced by build, do not hand-edit)");
      lines.push("", "These files are build artifacts. Never edit them directly:");
      for (const pattern of contract.paths.generated) {
        lines.push(`- ${wrapCodeSpan(pattern)}`);
      }
    }

    if (contract.paths.ignored.length > 0) {
      lines.push("", "### Ignored (do not include in agent output or consideration)");
      lines.push("", "These paths are out of scope for agent operations:");
      for (const pattern of contract.paths.ignored) {
        lines.push(`- ${wrapCodeSpan(pattern)}`);
      }
    }
  }

  // ── Further context ────────────────────────────────────────────────
  const hasArchitecture =
    contract.architecture.boundaries.length > 0 ||
    contract.architecture.invariants.length > 0 ||
    contract.architecture.keyDecisions.length > 0;
  if (hasArchitecture) {
    lines.push("", "## Architecture");
    if (contract.architecture.boundaries.length > 0) {
      lines.push("", "### Boundaries (must not)");
      for (const boundary of contract.architecture.boundaries) {
        lines.push("- " + escapeMarkdownText(boundary));
      }
    }
    if (contract.architecture.invariants.length > 0) {
      lines.push("", "### Invariants (always)");
      for (const invariant of contract.architecture.invariants) {
        lines.push("- " + escapeMarkdownText(invariant));
      }
    }
    if (contract.architecture.keyDecisions.length > 0) {
      lines.push("", "### Key Decisions");
      for (const decision of contract.architecture.keyDecisions) {
        lines.push(
          "- " + renderMarkdownLink(decision.file) + " — " + escapeMarkdownText(decision.summary),
        );
      }
    }
  }

  const hasAgentConstraints =
    contract.agents.disallowedActions.length > 0 ||
    contract.agents.approvalRequiredFor.length > 0 ||
    contract.agents.contextFiles.length > 0;
  if (hasAgentConstraints) {
    lines.push("", "## Agent Constraints");
    if (contract.agents.disallowedActions.length > 0) {
      lines.push("", "### Do Not");
      for (const action of contract.agents.disallowedActions) {
        lines.push("- " + escapeMarkdownText(action));
      }
    }
    if (contract.agents.approvalRequiredFor.length > 0) {
      lines.push("", "### Ask Before");
      for (const action of contract.agents.approvalRequiredFor) {
        lines.push("- " + escapeMarkdownText(action));
      }
    }
    if (contract.agents.contextFiles.length > 0) {
      lines.push("", "### Context Files");
      for (const path of contract.agents.contextFiles) {
        lines.push("- " + renderMarkdownLink(path));
      }
    }
  }

  const hasContent = contract.instructions.content !== undefined;
  const hasSources = contract.instructions.sources.length > 0;

  lines.push("", "## Further Context");
  if (hasContent) {
    lines.push("", contract.instructions.content);
  }
  if (hasSources) {
    lines.push(
      "",
      "See these files for detailed project documentation. If you need deeper",
      "context about architecture, conventions, or design rationale, start here:",
    );
    for (const source of contract.instructions.sources) {
      lines.push(`- ${renderMarkdownLink(source)}`);
    }
  }
  if (!hasContent && !hasSources) {
    lines.push("", "(none declared)");
  }

  // ── Before committing checklist ────────────────────────────────────
  if (contract.verification.required.length > 0) {
    lines.push("", "## Before Submitting Work");
    lines.push("", "After making changes, confirm everything still passes:");
    for (const name of contract.verification.required) {
      const cmd = contract.commands.find((c) => c.name === name);
      lines.push(`- Run ${wrapCodeSpan(cmd?.run ?? name)}`);
    }
  }

  return lines.join("\n");
}

// ── Command grouping ──────────────────────────────────────────────────────

const COMMAND_CATEGORIES: Readonly<Record<string, string>> = {
  build: "Build & Typecheck",
  typecheck: "Build & Typecheck",
  lint: "Code Quality",
  format: "Code Quality",
  check: "Code Quality",
  test: "Testing",
  "test-e2e": "Testing",
  ci: "CI / Automation",
};

/**
 * Groups commands into well-known categories for more scannable output.
 * Commands not in any category go into "Other Commands". Categories
 * appear in a fixed order; within each category, commands preserve
 * their contract-declared order.
 */
function groupCommands(
  commands: readonly NormalizedCommand[],
): readonly [string, readonly NormalizedCommand[]][] {
  const categoryOrder = [
    "Build & Typecheck",
    "Code Quality",
    "Testing",
    "CI / Automation",
    "Other Commands",
  ];
  const map = new Map<string, NormalizedCommand[]>();

  for (const cmd of commands) {
    const category = COMMAND_CATEGORIES[cmd.name] ?? "Other Commands";
    const list = map.get(category);
    if (list !== undefined) {
      list.push(cmd);
    } else {
      map.set(category, [cmd]);
    }
  }

  const result: [string, readonly NormalizedCommand[]][] = [];
  for (const cat of categoryOrder) {
    const list = map.get(cat);
    if (list !== undefined && list.length > 0) {
      result.push([cat, list]);
    }
  }

  return result;
}
