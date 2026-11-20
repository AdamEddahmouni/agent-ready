# Phase 1 benchmark report

**Decision:** `noDemonstratedBenefit`

**Raw run manifests:** `fixture-reproduction-2026-11-17`

## Summary

| Condition | Valid runs | Task success | 95% Wilson | Invalid assumptions | Incorrect dep. reasoning | Verification failure | Reads median |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| raw | 2 | 100.0% | 34.2%–100.0% | 0.00 | 0.00 | 0.0% | 1.50 |
| agent-ready | 3 | 100.0% | 43.8%–100.0% | 0.00 | 0.00 | 0.0% | 2.00 |

## Variance

| Condition | Success variance | Invalid assumptions variance | Dep. reasoning variance | Verification failure variance | Reads variance |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.5000 |
| agent-ready | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.3333 |

## Per-task results

| Task | Condition | Runs | Success | 95% Wilson | Invalid assumptions | Dep. reasoning | Verification failure | Reads median |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| fixture-task-alpha | raw | 2 | 100.0% | 34.2%–100.0% | 0.00 | 0.00 | 0.0% | 1.50 |
| fixture-task-alpha | agent-ready | 3 | 100.0% | 43.8%–100.0% | 0.00 | 0.00 | 0.0% | 2.00 |

## Valid runs

| Run | Task | Condition | Index | Success | Time to first correct (s) | Invalid assumptions | Dep. findings | Verification failure | Unnecessary reads |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: |
| fixture-reproduction-2026-11-17#fixture-task-alpha#agent-ready#0 | fixture-task-alpha | agent-ready | 0 | yes | 10.00 | 0 | 0 | no | 2 |
| fixture-reproduction-2026-11-17#fixture-task-alpha#agent-ready#1 | fixture-task-alpha | agent-ready | 1 | yes | 15.00 | 0 | 0 | no | 1 |
| fixture-reproduction-2026-11-17#fixture-task-alpha#agent-ready#2 | fixture-task-alpha | agent-ready | 2 | yes | 18.00 | 0 | 0 | no | 2 |
| fixture-reproduction-2026-11-17#fixture-task-alpha#raw#0 | fixture-task-alpha | raw | 0 | yes | 12.50 | 0 | 0 | no | 1 |
| fixture-reproduction-2026-11-17#fixture-task-alpha#raw#1 | fixture-task-alpha | raw | 1 | yes | 20.00 | 0 | 0 | no | 2 |

## Excluded runs

| Run | Reason |
| --- | --- |
| fixture-reproduction-2026-11-17#fixture-task-alpha#raw#2 | forbidden-action |
| fixture-reproduction-2026-11-17#fixture-task-beta#raw#0 | infrastructure-failure |

## Limitations

- Results are screened with the predeclared decision rule; this is not a significance test.
- All valid runs are reported. No best-of-N selection or task cherry-picking is applied.
- Wilson intervals apply to binary rates; variance is sample variance (n - 1) and is null for n < 2.
- Unnecessary-read counts depend on post-hoc adjudication; unadjudicated runs count only reads explicitly marked unnecessary.
- Manual-rubric outcomes require two reviewers and a third reviewer for disagreement; adjudications live outside raw logs.
- Token metrics may be null where the evaluation environment did not report them.

## Checksums

Combined raw checksum: `230614035c1d57983907dec4079ca8d76d3cdeb0195277e3afe22f3c78d7082b`

| Raw file | SHA-256 |
| --- | --- |
| run-00-alpha-raw-0.json | `7b349c7e3bd8389a37017a0cf22e0d2931e297e6cf4da604b2bc3e9bf5bf9309` |
| run-01-alpha-raw-1.json | `5ffb33fa672ab6a107dea42f4a476c6ab227ccf20dbd2fa35bef1bcf6a113cae` |
| run-02-alpha-raw-2.json | `287a1d34437c5cb69282b1edb62bfbb51a6f4172e71e88b6a0dd14d890800d85` |
| run-03-alpha-agent-ready-0.json | `d28735cb7e75aca4d5717c9265836cfd25632a19ed6c09be2f0f7b856ce965ce` |
| run-04-alpha-agent-ready-1.json | `9cd098017e2da759e9d7c260423b7b41908db9606b4744bfc15f2074a9ffccbd` |
| run-05-alpha-agent-ready-2.json | `6c47547f4c3839479054dd03616b9f45b013475fbc5d04dbaaffc8af85df4e9c` |
| run-06-beta-raw-0.json | `2cc5d51b3de861a0159869786745c77354179045768c62dfe9f6777a72151bc5` |
