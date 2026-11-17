# Phase 1 git workflow — run from repo root when the terminal works.
# Does not run tests (run pnpm test && pnpm conformance:check first).

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

git branch --show-current

# --- #40: three commits on feat/vnext-snapshot-conformance ---
git checkout feat/vnext-snapshot-conformance

git add conformance/discovery src/conformance scripts/conformance.ts `
  scripts/author-conformance-corpus.mjs scripts/write-conformance-metadata.mjs `
  tests/integration/discoveryConformance.test.ts tests/integration/discoverCliBinary.test.ts `
  tests/integration/discoverSnapshotSchema.test.ts package.json `
  schemas/discovery/snapshot-v1.schema.json

git commit -m @"
test(conformance): add discovery snapshot v1 corpus and enforcement

Eight local fixtures with byte-exact expected output, integration tests,
and maintainer conformance:check/update entry points.
"@

git add docs/vnext/SNAPSHOT-STABILITY.md conformance/discovery/README.md `
  docs/specification/discovery.md docs/vnext/PHASE-1-ISSUES.md CHANGELOG.md

git commit -m @"
docs: publish Discovery Snapshot Format 1 stability contract

Consumer-facing field stability, conformance README, and discovery spec links.
"@

git add .github/workflows/ci.yml

git commit -m @"
ci: enforce discovery snapshot conformance

Run conformance:check on the OS matrix and expect snapshotVersion 1 in discover smoke.
"@

git push -u origin feat/vnext-snapshot-conformance

# --- #42: protocol branch from #40 tip ---
$tip40 = git rev-parse HEAD
git checkout -b research/vnext-phase1-benchmark-protocol

git add docs/research/phase1-benchmark-protocol schemas/research `
  research/phase1-benchmark tests/research package.json

git commit -m @"
research(vnext): define Phase 1 benchmark protocol v1

Fixed repos, tasks, metrics, decision rule, raw schema, and offline validators.
No evaluation runs.
"@

git push -u origin research/vnext-phase1-benchmark-protocol

# --- #41: twin branch stacked on #42 ---
git checkout -b feat/vnext-twin-query

git add docs/decisions/0049-snapshot-build-and-bounded-query.md docs/decisions/README.md `
  src/cli/commands/twinBuild.ts src/cli/commands/twinQuery.ts `
  src/discover/snapshotSchema.ts src/twin/queryEngine.ts `
  src/cli/index.ts tests/integration/twinQuery.test.ts CHANGELOG.md

git commit -m @"
feat(twin): snapshot build and bounded snapshot-only query

ADR-0049 twin build writes validated Format 1; twin query reads snapshot only.
"@

git push -u origin feat/vnext-twin-query

Write-Host "#40 tip: $tip40"
Write-Host "#42 tip: $(git rev-parse research/vnext-phase1-benchmark-protocol)"
Write-Host "#41 tip: $(git rev-parse feat/vnext-twin-query)"
