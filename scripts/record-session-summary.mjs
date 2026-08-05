#!/usr/bin/env node

/**
 * record-session-summary.mjs — Record a completed session summary to the work log.
 *
 * Appends a dated entry to docs/WORK_LOG.md. Accepts a description and
 * optional file/command lists via command-line arguments or stdin.
 *
 * Usage:
 *   node scripts/record-session-summary.mjs "Description of work done"
 *   node scripts/record-session-summary.mjs --description "..." --files "a,b" --commands "c,d"
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function parseArgs() {
  const args = process.argv.slice(2);
  let description = "";
  let files = "";
  let commands = "";

  if (args.length === 1 && !args[0].startsWith("--")) {
    description = args[0];
  } else {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--description" && i + 1 < args.length) {
        description = args[++i];
      } else if (args[i] === "--files" && i + 1 < args.length) {
        files = args[++i];
      } else if (args[i] === "--commands" && i + 1 < args.length) {
        commands = args[++i];
      }
    }
  }

  return { description, files, commands };
}

function main() {
  const { description, files, commands } = parseArgs();

  if (!description) {
    console.error("Usage: node scripts/record-session-summary.mjs <description>");
    console.error(
      '       node scripts/record-session-summary.mjs --description "..." [--files "a,b"] [--commands "c,d"]',
    );
    process.exit(1);
  }

  const workLogPath = resolve(repoRoot, "docs", "WORK_LOG.md");

  if (!existsSync(workLogPath)) {
    console.error("ERROR: docs/WORK_LOG.md not found.");
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  let entry = `\n## ${today} — ${description}\n\n`;

  if (files) {
    entry += `**Files changed:**\n`;
    for (const f of files.split(",")) {
      entry += `- \`${f.trim()}\`\n`;
    }
    entry += `\n`;
  }

  if (commands) {
    entry += `**Commands run:**\n`;
    for (const c of commands.split(",")) {
      entry += `- \`${c.trim()}\`\n`;
    }
    entry += `\n`;
  }

  entry += `**Status:** Completed.\n`;

  const existing = readFileSync(workLogPath, "utf8");
  writeFileSync(workLogPath, existing + entry);
  console.log(`Session recorded to docs/WORK_LOG.md`);
}

main();
