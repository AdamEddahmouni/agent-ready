# Phase 1 benchmark report

**Decision:** `noDemonstratedBenefit`

**Raw run manifests:** `phase1-v1-2026-11-19`

## Summary

| Condition | Valid runs | Task success | 95% Wilson | Invalid assumptions | Incorrect dep. reasoning | Verification failure | Reads median |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| raw | 1 | 100.0% | 20.7%–100.0% | 0.00 | 0.00 | 0.0% | 0.00 |
| agent-ready | 1 | 100.0% | 20.7%–100.0% | 0.00 | 0.00 | 0.0% | 0.00 |

## Variance

| Condition | Success variance | Invalid assumptions variance | Dep. reasoning variance | Verification failure variance | Reads variance |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw | n/a | n/a | n/a | n/a | n/a |
| agent-ready | n/a | n/a | n/a | n/a | n/a |

## Per-task results

| Task | Condition | Runs | Success | 95% Wilson | Invalid assumptions | Dep. reasoning | Verification failure | Reads median |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| axios-03-add-sponsor-data-check | raw | 1 | 100.0% | 20.7%–100.0% | 0.00 | 0.00 | 0.0% | 0.00 |
| axios-03-add-sponsor-data-check | agent-ready | 1 | 100.0% | 20.7%–100.0% | 0.00 | 0.00 | 0.0% | 0.00 |

## Valid runs

| Run | Task | Condition | Index | Success | Time to first correct (s) | Invalid assumptions | Dep. findings | Verification failure | Unnecessary reads |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: |
| phase1-v1-2026-11-19#axios-03-add-sponsor-data-check#agent-ready#0 | axios-03-add-sponsor-data-check | agent-ready | 0 | yes | 16.80 | 0 | 0 | no | 0 |
| phase1-v1-2026-11-19#axios-03-add-sponsor-data-check#raw#0 | axios-03-add-sponsor-data-check | raw | 0 | yes | 11.75 | 0 | 0 | no | 0 |

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

Combined raw checksum: `81692bd590c1328232193f38ee65b5f5fdf01d9b06c39b2e6535a7ef01cc6ca4`

| Raw file | SHA-256 |
| --- | --- |
| axios-03-add-sponsor-data-check--agent-ready--0.json | `e4dc829254722f047ed102979d8ee092b66b4dee92655c13706dc77ad34047a3` |
| axios-03-add-sponsor-data-check--raw--0.json | `90017e07d0cb45b52ebf8693918cf06b10ac71ddeee4594e309c6de140e4adbb` |
