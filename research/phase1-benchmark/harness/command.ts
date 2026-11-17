import { exec } from "node:child_process";
import type { CommandExecution, CommandExecutor } from "./score.js";

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function exitCodeOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function timedOutOf(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (error as { readonly killed?: unknown }).killed === true;
}

/**
 * Capturing executor for `command-exit-zero` checks. Commands come only from
 * the frozen protocol, never from an agent or a run manifest, and are run
 * through the native shell because the protocol declares literal command
 * lines. Output is bounded and retained only for the caller's diagnostic
 * result, not copied into a raw record by default.
 */
export class NodeCommandExecutor implements CommandExecutor {
  run(command: string, cwd: string, timeoutMs: number): Promise<CommandExecution> {
    return new Promise((resolve) => {
      exec(
        command,
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          resolve({
            exitCode: error === null ? 0 : exitCodeOf(error),
            timedOut: timedOutOf(error),
            stdout,
            stderr,
          });
        },
      );
    });
  }
}
