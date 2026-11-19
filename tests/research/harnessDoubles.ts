import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CheckoutRequest,
  PreparedWorkspace,
  RepositoryFetcher,
  SnapshotBuilder,
} from "../../research/phase1-benchmark/harness/prepare.js";
import type {
  CommandExecution,
  CommandExecutor,
} from "../../research/phase1-benchmark/harness/score.js";

export class FixtureFetcher implements RepositoryFetcher {
  readonly calls: CheckoutRequest[] = [];

  constructor(private readonly packageJson = '{"name":"fixture"}\n') {}

  async checkout(request: CheckoutRequest): Promise<void> {
    this.calls.push(request);
    await mkdir(request.destination, { recursive: true });
    await writeFile(join(request.destination, "package.json"), this.packageJson, "utf8");
  }
}

export class FixtureSnapshotBuilder implements SnapshotBuilder {
  async build(workspace: PreparedWorkspace): Promise<string> {
    const path = join(workspace.runRoot, "snapshot.json");
    await writeFile(path, '{"ok":true,"snapshotVersion":1}\n', "utf8");
    return path;
  }
}

export class FakeCommandExecutor implements CommandExecutor {
  async run(): Promise<CommandExecution> {
    return await Promise.resolve({ exitCode: 0, timedOut: false, stdout: "", stderr: "" });
  }
}
