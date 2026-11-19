# Runner adapter contract — agent transcripts v1

**Status:** implemented in the harness; no real capture exists yet.

The harness scores observations, not processes. `AgentRunner` in
[`harness/run.ts`](harness/run.ts) is the only seam between the benchmark and a
coding agent: given an `AgentRunRequest`, it returns `AgentObservations`. This
document defines the second half of that seam — how a real session becomes a
transcript the harness can score, replay, and archive.

## Why a normalized transcript exists

A raw client log is a vendor format. Scoring directly from it would make the
benchmark depend on whichever client produced it, and would let a log's shape
change between trials without the protocol noticing. Instead:

1. **Adapter** — a `AgentRunner` implementation launches the agent, records its
   tool events, and writes one **Agent Transcript v1** document.
2. **Replay** — `TranscriptReplayRunner` turns that document back into
   `AgentObservations`, which the existing scorer consumes unchanged.

A trial is therefore reproducible from the transcript alone: no model, no
network, no subprocess. That is what makes a published raw run auditable. A
replay whose task, condition, model, or client disagrees with the transcript
throws `TranscriptRunMismatchError` (a `HarnessAbortError`), so `executeTrial`
aborts instead of recording a trial that was never run as an infrastructure
failure.

## The v1 document

Schema: [`schemas/research/phase1-benchmark-transcript-v1.schema.json`](../../schemas/research/phase1-benchmark-transcript-v1.schema.json).
Implementation: [`harness/transcript.ts`](harness/transcript.ts).

| Field                                            | Meaning                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `transcriptVersion`                              | `1`. A change to event kinds or required fields is a new version.                               |
| `taskId`, `condition`                            | The protocol task and condition this session actually ran.                                      |
| `agent.client`, `agent.version`, `agent.modelId` | What produced the session. Replay rejects a request that disagrees.                             |
| `provenance`                                     | `captured: true` plus the source client log format and capture time.                            |
| `startedAt`                                      | Trial start, ISO 8601.                                                                          |
| `events`                                         | Ordered `read` / `write` / `shell` / `search` / `other` events with `atMs` from trial start.    |
| `finalResponse`                                  | The agent's final message, verbatim.                                                            |
| `usage`                                          | `input` / `output` / `cached` / `reasoning` token counts; `null` where the client reports none. |
| `verificationSelectionResult`                    | Post-hoc adjudication; absent means `false` (fail closed).                                      |
| `notes`                                          | Optional, recorded as a limitation.                                                             |

Replay **applies the recorded writes** to the prepared workspace, in recorded
order, before scoring. An edit-task oracle reads a file, not an event log, so
without materialization a transcript that describes a correct edit would fail
its own oracle. Writes are resolved inside the workspace and refused if any path
component is a symbolic link.

Rules the schema cannot express, enforced by `parseTranscript`:

- Every `path` is repository-relative. Absolute paths and `..` are rejected.
- `atMs` values never decrease. An adapter that receives interleaved
  timestamps must normalize them before writing, not silently reorder events.
- Unknown event kinds are rejected. A client that invents a tool must map it to
  `other` explicitly.

## Provenance is not optional

`TranscriptReplayRunner` refuses a transcript whose `provenance.captured` is not
`true` unless the caller passes `allowAuthored: true`. Only tests may pass it.

This is deliberate. An authored transcript can be shaped to pass; a captured one
is evidence. The repository ships one authored fixture
([`tests/fixtures/research/transcript-axios-01-identify-test-script.json`](../../tests/fixtures/research/transcript-axios-01-identify-test-script.json))
to exercise the seam, and it is labelled as authored in its own provenance
block. It is not a benchmark result and must never be aggregated as one.

## Capturing with the Claude Code adapter

`transcriptFromClaudeCodeStream` ([`harness/claudeCode.ts`](harness/claudeCode.ts))
converts a Claude Code `--output-format stream-json` session into Transcript v1.
It maps `Read`, `Write`, `Edit`, `MultiEdit`, `Bash`, `Grep`, and `Glob` to the
event kinds above, grounds an `Edit` by applying `old_string` → `new_string`
against the workspace file, and takes the model, client version, final response,
and token usage from the stream's `init` and `result` events.

```ts
const capture = await transcriptFromClaudeCodeStream(streamJsonl, {
  taskId: task.id,
  condition: "raw",
  workspaceRoot: workspace.path,
  startedAt,
  capturedAt: new Date().toISOString(),
  timing: (index) => elapsedPerEvent[index], // measured in a live capture
});
// capture.transcript is schema-validated and replayable
```

The adapter throws on anything it cannot ground: a path outside the workspace,
an edit whose target text is absent, a stream with no model, or a stream with no
`result` usage. It does not guess.

**Bash.** A recorded shell event carries no resulting files, so the adapter
cannot trust the command text on its own. Classification is only a hint about
where to look: read-only commands (`cat`, `ls`, `git status`, …) pass; a command
that certainly writes (`sed -i`, a redirect to a file, `rm`/`mv`/`cp`, a
package-manager install, a formatter or build, a mutating `git` subcommand) is a
refusal candidate; an interpreter (`node`, `python`, a shell) is a warning
candidate. Commands wrapped as `/bin/bash -lc "…"` are classified by the
command they carry, because Codex runs every shell command that way.

The verdict comes from the checkout, not the text: the adapter compares the
recorded write paths with the paths `git status --porcelain -z` reports as
changed. When every changed path is recorded as a write, the capture is
accepted and a note says so. When a changed path is unrecorded, a refusal
candidate makes the adapter **refuse** — a replay would score a workspace the
session changed — and without one it records `shellMutationRisk: true`. A
directory git cannot answer for is never treated as coverage: a refusal
candidate still refuses. Passing `onShellMutation: "flag"` accepts a gap the
adapter would otherwise refuse, and the flag still records that replay may
diverge.

**Timing.** A saved log carries no per-event timestamps. When `timing` is
omitted, `atMs` is the event index, `timingIsSequenceDerived` is `true`, and the
transcript records that as a limitation. Such a transcript is fine for
correctness and tool-use metrics, but it must not be used to report
time-to-first-correct-modification.

## Capturing with the Codex adapter

`transcriptFromCodexStream` ([`harness/codex.ts`](harness/codex.ts)) converts
`codex exec --json` JSONL into the same document. It maps
`command_execution` to `shell`, `web_search` to `search`, and MCP calls, plan
updates and any item type it does not model to `other` (an item with no type at
all is recorded as `unrecognized-item`) rather than dropping it. Each
`file_change` becomes a `write` by reading the changed file from the workspace
Codex ran in — the stream reports only a path and a kind, never the content, and
the read happens when the adapter runs, so convert a saved log against the
checkout before anything else touches it. It refuses a deletion, because a
write event cannot express one and a replay would keep the file, and keeps only
the last `file_change` per path.

Codex events carry no model or client version, so `modelId` is required and an
omitted `clientVersion` is recorded as `unknown`. Usage comes from
`turn.completed`; a resumed thread reports the running total, which the adapter
notes when it sees more than one turn. Bash follows the same rule as the Claude
Code adapter: reported `file_change` paths are checked against the checkout, so
an unrecorded change is what triggers a refusal or `shellMutationRisk`.

`pnpm research:benchmark-capture` ([`capture.ts`](capture.ts)) applies either
adapter to a saved log and writes the transcript. It validates the task id
against protocol v1, requires `--started-at` because no client stream records the
session's start, and keeps the checkout codex ran in as `--workspace`.

One real Codex session is recorded in [`captures/`](captures/README.md), with
its raw log, the transcript, and the replay result. It is a single session, not
a protocol run.

## Capturing the first real transcript (pilot, #57)

The environment for the pilot is not yet fixed. When it is:

1. Record the client's native event log to disk, unmodified.
2. Convert it to Transcript v1 with a dedicated adapter — no hand editing of
   tool events, paths, or timings after the fact. Any lost field is recorded as
   a limitation, not filled in.
3. Write the transcript under the run directory beside its raw record, and set
   `provenance.captured: true` with `clientLogFormat` and `capturedAt`.
4. Replay it through `executeTrial` and confirm the resulting raw record matches
   what the live trial produced. A mismatch means the adapter is lossy.

One installed client, Claude Code `2.1.316`, exposes a JSON event stream
(`--print --output-format stream-json`) that the bundled adapter converts. Other
clients need their own adapter; the contract does not privilege one.

The first real capture is also the pilot's first acceptance check: if the
adapter cannot reproduce a live score byte-for-byte, the harness is not ready
for the 78-trial run.
