#!/usr/bin/env node

/**
 * project-context-preview.mjs — Print a summary of the project context
 * that the Brain MCP would use to understand this repository.
 *
 * Reads agent-ready.yaml, docs/STATUS.md, and key documentation to
 * produce a structured preview of the project's identity, current state,
 * known limitations, and available decision records.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function tryRead(path) {
  const absPath = resolve(repoRoot, path);
  return existsSync(absPath) ? readFileSync(absPath, "utf8") : null;
}

function main() {
  console.log("=== Project Context Preview ===\n");

  // 1. Contract summary
  const contractRaw = tryRead("agent-ready.yaml");
  if (contractRaw) {
    const contract = parseYaml(contractRaw);
    console.log("--- Contract (agent-ready.yaml) ---");
    console.log(`  Name:        ${contract.project?.name}`);
    console.log(`  Description: ${contract.project?.description?.slice(0, 120)}...`);
    console.log(
      `  Commands:    ${contract.commands ? Object.keys(contract.commands).join(", ") : "none"}`,
    );
    console.log(`  Verification: ${contract.verification?.required?.join(", ") || "none"}`);
    console.log(
      `  Adapters:    ${
        contract.adapters
          ? Object.keys(contract.adapters)
              .filter((k) => contract.adapters[k]?.enabled)
              .join(", ") || "none enabled"
          : "none"
      }`,
    );
    console.log();
  }

  // 2. Status summary
  const statusRaw = tryRead("docs/STATUS.md");
  if (statusRaw) {
    console.log("--- Status (docs/STATUS.md) ---");
    // Extract version line
    const versionMatch = statusRaw.match(/\*\*Version\*\*\s*\|\s*(.+)/);
    if (versionMatch) console.log(`  Version: ${versionMatch[1]}`);
    const stageMatch = statusRaw.match(/\*\*Stage\*\*\s*\|\s*(.+)/);
    if (stageMatch) console.log(`  Stage:   ${stageMatch[1]}`);
    console.log();
  }

  // 3. Decision records
  console.log("--- Decision Records ---");
  const adrsReadme = tryRead("docs/decisions/README.md");
  if (adrsReadme) {
    const count = (adrsReadme.match(/^\|\s*\[?\d{4}\]?/gm) || []).length;
    console.log(`  Total ADRs: ${count}`);
    console.log("  See: docs/decisions/README.md");
  } else {
    console.log("  Not found");
  }
  console.log();

  // 4. Lessons
  console.log("--- Verified Lessons ---");
  const lessonsRaw = tryRead("docs/LESSONS.md");
  if (lessonsRaw) {
    const count = (lessonsRaw.match(/LESSON-\d+/g) || []).length;
    console.log(`  Entries: ${count}`);
    console.log("  See: docs/LESSONS.md");
  } else {
    console.log("  Not found");
  }
  console.log();

  // 5. Known limitations
  console.log("--- Known Limitations (from threat model) ---");
  console.log("  See: docs/security/threat-model.md#known-limitations");

  // 6. Next steps
  console.log("\n--- What's Next ---");
  const roadmapRaw = tryRead("ROADMAP-TO-1.0.md");
  if (roadmapRaw) {
    // Find the first incomplete milestone
    const incompleteMatch = roadmapRaw.match(/Milestone \d+.*?\*\*Status:\*\*\s*(.*?)(?=\n###|$)/s);
    if (incompleteMatch && !incompleteMatch[1].includes("Complete")) {
      console.log(`  Next milestone: ${incompleteMatch[0].split("\n")[0]}`);
    } else {
      console.log("  See: ROADMAP-TO-1.0.md");
    }
  } else {
    console.log("  See: ROADMAP-TO-1.0.md");
  }

  console.log("\n=== End of Context Preview ===");
}

main();
