# Captured transcripts

Real client sessions converted with `pnpm research:benchmark-capture`. Nothing
here is authored, and none of them is a protocol run.

## axios-02-add-devdep · Codex CLI · 2026-11-19

|            |                                                                                      |
| ---------- | ------------------------------------------------------------------------------------ |
| Raw log    | `axios-02-add-devdep-codex-gpt-6.2-sol.jsonl` (`codex exec --json`)                  |
| Transcript | `axios-02-add-devdep-codex-gpt-6.2-sol.json`                                         |
| Client     | `codex-cli` 0.166.0, model `gpt-6.2-sol`, `--sandbox workspace-write`                |
| Checkout   | axios `2426e03ba9020be31ed013873423cea6b7cd2e67`, prepared by `GitRepositoryFetcher` |
| Prompt     | the protocol task text, unedited                                                     |
| Usage      | 92,038 input / 86,400 cached / 378 output / 0 reasoning                              |

The session added `"semver": "^7.6.0"` under `dependencies` and changed nothing
else. Replaying the transcript with `executeTrial` and `TranscriptReplayRunner`
against a fresh checkout scores `success: true` with no forbidden actions, and
the replayed `package.json` is byte-identical to the session's (6,705 bytes,
sha256 `190276674f76d0b2a427f81e369a29b5001c07734a11d90168b1106e37c32479`).

Reproduction test: `tests/research/phase1BenchmarkCapture.test.ts` replays this
transcript through `executeTrial` and fails if it stops scoring success, gains a
forbidden action, or starts carrying `shellMutationRisk`.

**Bash.** After its `file_change` item the session ran
`truncate -s -1 package.json`, so the capture depends on the rule that compares
the checkout with the transcript: every recorded write still holds the recorded
bytes, and every path git reports as changed is recorded. Both hold here, so the
transcript carries no `shellMutationRisk` and its note records the
classification (`1 certain, 2 possible` mutating commands). The offline
conversion read the file after the session finished; converting while the
session ran would have recorded the pre-truncate content.

Limitations recorded in the transcript:

- `atMs` is sequence-derived, not measured, so this capture must not be used to
  report time-to-first-correct-modification.
- One session on one task. It is not part of the 78-trial run, and the pilot
  environment (#57) is not frozen.

## axios-03-add-sponsor-data-check · Codex CLI · 2026-11-19

|            |                                                                                      |
| ---------- | ------------------------------------------------------------------------------------ |
| Raw log    | `axios-03-add-sponsor-data-check-codex-gpt-6.2-sol.jsonl` (`codex exec --json`)      |
| Transcript | `axios-03-add-sponsor-data-check-codex-gpt-6.2-sol.json`                             |
| Client     | `codex-cli` 0.166.0, model `gpt-6.2-sol`, `--sandbox workspace-write`                |
| Checkout   | axios `2426e03ba9020be31ed013873423cea6b7cd2e67`, prepared by `GitRepositoryFetcher` |
| Prompt     | the protocol task text, unedited                                                     |
| Usage      | 54,211 input / 45,184 cached / 251 output / 0 reasoning                              |

The session added a `check:sponsor-data` script that parses
`docs/data/sponsors.json` with `node -e` and ran `npm run check:sponsor-data`
(exit 0). Replaying it against a fresh checkout scores `success: true` with no
forbidden actions, satisfies both `all-of` clauses, and reproduces the session's
`package.json` byte for byte (6,802 bytes, sha256
`2275f727b84a675d61690294a0a8b0775694dc047a1bbaa58b85459e48824b28`).

This transcript carries no `shellMutationRisk`: the only changed path is
`package.json`, which is recorded as a write, and its bytes still match.
`tests/research/phase1BenchmarkCapture.test.ts` guards the artifact's shape;
the end-to-end replay above, including the `command-exit-zero` clause, was run
with a real command executor and is recorded here rather than re-run in CI,
which uses a fake executor for that clause.
