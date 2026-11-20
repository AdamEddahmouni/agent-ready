# Phase 1 benchmark report

**Decision:** `noDemonstratedBenefit`

**Raw run manifests:** `phase1-v1-2026-11-19`

## Summary

| Condition | Valid runs | Task success | 95% Wilson | Invalid assumptions | Incorrect dep. reasoning | Verification failure | Reads median |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| raw | 1 | 100.0% | 20.7%–100.0% | 0.00 | 0.00 | 100.0% | 0.00 |
| agent-ready | 1 | 100.0% | 20.7%–100.0% | 0.00 | 0.00 | 100.0% | 0.00 |

## Variance

| Condition | Success variance | Invalid assumptions variance | Dep. reasoning variance | Verification failure variance | Reads variance |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw | n/a | n/a | n/a | n/a | n/a |
| agent-ready | n/a | n/a | n/a | n/a | n/a |

## Per-task results

| Task | Condition | Runs | Success | 95% Wilson | Invalid assumptions | Dep. reasoning | Verification failure | Reads median |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| axios-03-add-sponsor-data-check | raw | 1 | 100.0% | 20.7%–100.0% | 0.00 | 0.00 | 100.0% | 0.00 |
| axios-03-add-sponsor-data-check | agent-ready | 1 | 100.0% | 20.7%–100.0% | 0.00 | 0.00 | 100.0% | 0.00 |

## Valid runs

| Run | Task | Condition | Index | Success | Time to first correct (s) | Invalid assumptions | Dep. findings | Verification failure | Unnecessary reads |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: |
| phase1-v1-2026-11-19#axios-03-add-sponsor-data-check#agent-ready#0 | axios-03-add-sponsor-data-check | agent-ready | 0 | yes | 8.38 | 0 | 0 | yes | 0 |
| phase1-v1-2026-11-19#axios-03-add-sponsor-data-check#raw#0 | axios-03-add-sponsor-data-check | raw | 0 | yes | 9.86 | 0 | 0 | yes | 0 |

## Excluded runs

None.

## Limitations

- Results are screened with the predeclared decision rule; this is not a significance test.
- All valid runs are reported. No best-of-N selection or task cherry-picking is applied.
- Wilson intervals apply to binary rates; variance is sample variance (n - 1) and is null for n < 2.
- Unnecessary-read counts depend on post-hoc adjudication; unadjudicated runs count only reads explicitly marked unnecessary.
- Manual-rubric outcomes require two reviewers and a third reviewer for disagreement; adjudications live outside raw logs.
- Token metrics may be null where the evaluation environment did not report them.

## Checksums

Combined raw checksum: `a41c5941162b62e49884dbf5058490eae2e910935ff7581fddeda5d753fa4111`

| Raw file | SHA-256 |
| --- | --- |
| axios-03-add-sponsor-data-check--agent-ready--0.json | `a90b6d63d63de086ea6803fc535c98f400434ddef19436b56940d4ea55e63768` |
| axios-03-add-sponsor-data-check--raw--0.json | `f2e28641bd1fb7bca8586f9c22433dea9f8a4e38256d475ddbc65a3050896226` |
