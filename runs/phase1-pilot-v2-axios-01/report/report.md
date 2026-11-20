# Phase 1 benchmark report

**Decision:** `noDemonstratedBenefit`

**Raw run manifests:** `phase1-v2-2026-11-19`

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
| axios-01-identify-test-script | raw | 1 | 100.0% | 20.7%–100.0% | 0.00 | 0.00 | 100.0% | 0.00 |
| axios-01-identify-test-script | agent-ready | 1 | 100.0% | 20.7%–100.0% | 0.00 | 0.00 | 100.0% | 0.00 |

## Valid runs

| Run | Task | Condition | Index | Success | Time to first correct (s) | Invalid assumptions | Dep. findings | Verification failure | Unnecessary reads |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: |
| phase1-v2-2026-11-19#axios-01-identify-test-script#agent-ready#0 | axios-01-identify-test-script | agent-ready | 0 | yes | n/a | 0 | 0 | yes | 0 |
| phase1-v2-2026-11-19#axios-01-identify-test-script#raw#0 | axios-01-identify-test-script | raw | 0 | yes | n/a | 0 | 0 | yes | 0 |

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

Combined raw checksum: `b279ff90c54f32a7b02dbd4be436e1cd69e6560b9be1fd481d77fd96a9b2a9b7`

| Raw file | SHA-256 |
| --- | --- |
| axios-01-identify-test-script--agent-ready--0.json | `e957290d94a13aa6c049b1cfb25f328ed2f766f8916bf3cd5466c3857a5b040e` |
| axios-01-identify-test-script--raw--0.json | `69232939fe21f1b2ef6793f49b386344ee95bc9464a72225d456465092db2f68` |
