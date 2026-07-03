import { spawn } from "node:child_process";
import type { CommandOutcome, CommandRunner, CommandToRun, RunCommandOptions } from "./types.js";

/**
 * Real CommandRunner backed by `node:child_process.spawn`. Invokes the
 * command's `run` string through the platform's native shell (`shell:
 * true`) — the same approach `npm run`/`pnpm run` use — because `run` is
 * documented (contract-reference.md) as "the literal command line," which
 * only makes sense under shell invocation (compound commands, redirection,
 * etc.). Output is inherited straight to this process's stdio; nothing is
 * captured, so the caller never has to worry about secrets landing in a
 * diagnostic or JSON result (see ADR-0014).
 *
 * Timeout is enforced with an explicit local timer rather than `spawn`'s
 * built-in `timeout` option: the built-in option signals the process on
 * expiry, but that signal is not reliably distinguishable from one sent by
 * something else. A local flag removes the ambiguity.
 */
export class NodeCommandRunner implements CommandRunner {
  run(command: CommandToRun, options: RunCommandOptions): Promise<CommandOutcome> {
    const startedAt = Date.now();

    return new Promise<CommandOutcome>((resolve) => {
      const child = spawn(command.run, {
        cwd: options.cwd,
        shell: true,
        stdio: "inherit",
        // POSIX only: makes the shell the leader of its own process group,
        // so a timeout can kill the whole tree (the shell plus whatever it
        // spawned), not just the shell itself — killing only the shell
        // process leaves its children (e.g. what `pnpm test` itself
        // spawned) running. See killTree below.
        detached: process.platform !== "win32",
      });

      let timedOut = false;
      let termination: Promise<void> | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        // Do not leave taskkill as an unobserved, pipe-owning child process.
        // In particular, Vitest cannot finish (and Windows cannot remove the
        // command's cwd) until both taskkill and the original process tree have
        // exited. killTree also falls back to killing the shell itself if tree
        // termination cannot be started.
        termination = killTree(child.pid, () => child.kill());
      }, options.timeoutMs);

      child.once("error", () => {
        clearTimeout(timer);
        resolve({
          id: command.id,
          run: command.run,
          status: "spawn-failed",
          exitCode: null,
          durationMs: Date.now() - startedAt,
        });
      });

      child.once("close", (code) => {
        void finishClose(code);
      });

      async function finishClose(code: number | null): Promise<void> {
        clearTimeout(timer);
        // The shell may emit `close` while taskkill is still walking its
        // descendants. Waiting here prevents callers from treating the cwd as
        // reusable while a descendant still has it open on Windows.
        await termination;
        const durationMs = Date.now() - startedAt;
        resolve({
          id: command.id,
          run: command.run,
          status: timedOut ? "timed-out" : code === 0 ? "passed" : "failed",
          exitCode: timedOut ? null : code,
          durationMs,
        });
      }
    });
  }
}

/**
 * Kills a spawned command and everything it spawned. `shell: true` means
 * `pid` is the shell's pid, not the pid of whatever the shell ran, so a
 * plain `kill(pid)` is not enough on either platform:
 * - Windows has no process-group signal semantics; `taskkill /t` walks the
 *   process tree explicitly.
 * - POSIX: the child was spawned with `detached: true`, making it the
 *   leader of its own process group; signalling the negative pid signals
 *   the whole group.
 */
async function killTree(pid: number | undefined, killShell: () => boolean): Promise<void> {
  if (pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    const killedTree = await new Promise<boolean>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => {
        resolve(false);
      });
      killer.once("close", (code) => {
        resolve(code === 0);
      });
    });
    if (!killedTree) {
      // Best-effort fallback. This cannot guarantee descendant termination on
      // Windows, but it does guarantee the shell is not left alive when
      // taskkill itself is unavailable or rejected.
      killShell();
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Process group already exited between the timeout firing and the kill.
  }
}
