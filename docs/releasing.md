# Releasing Agent-Ready

Release steps:

1. Update `CHANGELOG.md` and the version in `package.json`.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
   `pnpm test:package` on Node 20 and 22 where practical.
4. Open a PR, confirm the GitHub Actions OS matrix and composite-action dogfood
   job pass, then merge.
5. Create an annotated `v<version>` tag at the merge commit:
   `git tag -a v<version> -m "v<version>"`
6. Push the tag (this also pushes the commit if it hasn't been pushed yet):
   `git push origin v<version>`
7. The `.github/workflows/publish.yml` workflow triggers on the tag push and
   runs typecheck, tests, build, package smoke test, tag-version verification,
   and `npm publish --provenance --access public`.

The composite action and npm package are reproducible from the same tagged
commit. Publishing uses npm Trusted Publishing (OIDC) — no tokens or
secrets needed. For initial setup, link the GitHub repository to npm:

1. Log in to [npmjs.com](https://www.npmjs.com) and go to the
   `agent-ready` package.
2. **Settings** → **Trusted Publishing** → **Add Trusted Publisher**.
3. Choose **GitHub Actions**, enter:
   - Repository: `AdamEddahmouni/agent-ready-repo` (update if moved)
   - Workflow: `publish.yml`
4. Click **Create Trust**.
