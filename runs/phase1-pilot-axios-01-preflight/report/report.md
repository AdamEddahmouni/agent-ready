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

Combined raw checksum: `b13ea1ef9e7976929b13f6285e3eaa4514660127e93fd724ef2c5124ceffe704`

| Raw file | SHA-256 |
| --- | --- |
| axios-01-identify-test-script--agent-ready--0.json | `023f9dbc9bf0f3ce6ddc5c2b0a231392ebe24c8bd767db92afbded415405ac77` |
| axios-01-identify-test-script--raw--0.json | `bf0183a29fe31254346a975fa5a19a69e1575b0ea675f27262057738e594659d` |
