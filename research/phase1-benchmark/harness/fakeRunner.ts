import type { AgentObservations } from "./types.js";
import type { AgentRunRequest, AgentRunner } from "./run.js";

export type FakeRunnerBehavior = (
  request: AgentRunRequest,
) => AgentObservations | Promise<AgentObservations>;

/** A scripted runner. It never invokes a model, a network, or a subprocess. */
export class FakeAgentRunner implements AgentRunner {
  readonly requests: AgentRunRequest[] = [];

  constructor(private readonly behavior: FakeRunnerBehavior) {}

  async run(request: AgentRunRequest): Promise<AgentObservations> {
    this.requests.push(request);
    return await this.behavior(request);
  }
}

export function emptyObservations(overrides: Partial<AgentObservations> = {}): AgentObservations {
  return {
    finalResponse: "",
    toolCalls: [],
    fileReads: [],
    fileWrites: [],
    tokenMetrics: { input: null, output: null, cached: null, reasoning: null },
    assumptions: [],
    dependencyReasoningFindings: [],
    verificationSelectionResult: false,
    infrastructureFailure: false,
    ...overrides,
  };
}
