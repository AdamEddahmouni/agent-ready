# Phase 1 benchmark report

**Decision:** `noDemonstratedBenefit`

**Raw run manifests:** `phase1-v1-2026-11-19`

## Summary

| Condition | Valid runs | Task success | 95% Wilson | Invalid assumptions | Incorrect dep. reasoning | Verification failure | Reads median |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| raw | 1 | 0.0% | 0.0%–79.3% | 0.00 | 0.00 | 100.0% | 0.00 |
| agent-ready | 1 | 0.0% | 0.0%–79.3% | 0.00 | 0.00 | 100.0% | 0.00 |

## Variance

| Condition | Success variance | Invalid assumptions variance | Dep. reasoning variance | Verification failure variance | Reads variance |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw | n/a | n/a | n/a | n/a | n/a |
| agent-ready | n/a | n/a | n/a | n/a | n/a |

## Per-task results

| Task | Condition | Runs | Success | 95% Wilson | Invalid assumptions | Dep. reasoning | Verification failure | Reads median |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| axios-01-identify-test-script | raw | 1 | 0.0% | 0.0%–79.3% | 0.00 | 0.00 | 100.0% | 0.00 |
| axios-01-identify-test-script | agent-ready | 1 | 0.0% | 0.0%–79.3% | 0.00 | 0.00 | 100.0% | 0.00 |

## Valid runs

| Run | Task | Condition | Index | Success | Time to first correct (s) | Invalid assumptions | Dep. findings | Verification failure | Unnecessary reads |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: |
| phase1-v1-2026-11-19#axios-01-identify-test-script#agent-ready#0 | axios-01-identify-test-script | agent-ready | 0 | no | n/a | 0 | 0 | yes | 0 |
| phase1-v1-2026-11-19#axios-01-identify-test-script#raw#0 | axios-01-identify-test-script | raw | 0 | no | n/a | 0 | 0 | yes | 0 |

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

Combined raw checksum: `d698ce7cb0416fa9e01af0423014ea69f1f8c9999fc047b9a94abf758927b168`

| Raw file | SHA-256 |
| --- | --- |
| axios-01-identify-test-script--agent-ready--0.json | `4830b152d7e66686698c25970161d527a5b0dadbe04f254de32fd7ca147f1b3e` |
| axios-01-identify-test-script--raw--0.json | `6218c7fed4cac324b91f61561f35e4c0093850fa986c17008488645201c454c2` |
