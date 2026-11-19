import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CheckoutRequest,
  RepositoryFetcher,
} from "../../research/phase1-benchmark/harness/prepare.js";
import type {
  CommandExecution,
  CommandExecutor,
} from "../../research/phase1-benchmark/harness/score.js";

export class FixtureFetcher implements RepositoryFetcher {
  readonly calls: CheckoutRequest[] = [];

  async checkout(request: CheckoutRequest): Promise<void> {
    this.calls.push(request);
    await mkdir(request.destination, { recursive: true });
    await writeFile(join(request.destination, "package.json"), '{"name":"fixture"}\n', "utf8");
  }
}

export class FakeCommandExecutor implements CommandExecutor {
  async run(): Promise<CommandExecution> {
    return await Promise.resolve({ exitCode: 0, timedOut: false, stdout: "", stderr: "" });
  }
}
