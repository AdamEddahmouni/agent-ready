# Releasing Agent-Ready

Release steps:

1. Update `CHANGELOG.md` and the version in `package.json`.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
   `pnpm test:package` on Node 20 and 22 where practical. Also run
   `pnpm check:action-pins`.
4. Open a PR, confirm the GitHub Actions OS matrix and composite-action dogfood
   job pass, then merge.
5. Create an annotated `v<version>` tag at the merge commit:
   `git tag -a v<version> -m "v<version>"`
6. Push the tag (this also pushes the commit if it hasn't been pushed yet):
   `git push origin v<version>`
7. The `.github/workflows/publish.yml` workflow triggers on the tag push and
   runs typecheck, tests, build, package smoke test, tag-version verification,
   and `npm publish --provenance --access public`. Prerelease versions are
   published under npm's `next` tag; stable versions use `latest`. It then
   installs the exact published version in a clean directory, checks
   `--version`, and validates the minimal example.
8. The parallel `.github/workflows/release.yml` workflow creates the GitHub
   Release from the matching CHANGELOG section and attaches the npm package
   tarball plus the standalone adapter compatibility corpus.

The composite action and npm package are reproducible from the same tagged
commit. Normal publishing uses npm Trusted Publishing (OIDC), Node 24, and npm
11.5.1. No long-lived publish token is retained.

## First-publication bootstrap

npm requires a package to exist before a Trusted Publisher can be attached to
it. For the first publication only:

1. Make the GitHub repository public so npm provenance can link to the public
   source commit.
2. Create a short-lived, granular npm token authorized to publish
   `agent-ready`, store it as the repository secret `NPM_TOKEN`, and keep 2FA
   enabled on the npm account.
3. Push the first release tag. The publish workflow uses `NPM_TOKEN` for this
   bootstrap run and publishes prereleases under the `next` dist-tag.
4. Confirm the package and provenance on npm, then configure Trusted
   Publishing as described below.
5. Delete the `NPM_TOKEN` repository secret and revoke the token on npm. Future
   tag releases authenticate only through OIDC.

## Configure Trusted Publishing

1. Log in to [npmjs.com](https://www.npmjs.com) and go to the
   `agent-ready` package.
2. **Settings** → **Trusted Publishing** → **Add Trusted Publisher**.
3. Choose **GitHub Actions**, enter:
   - Repository: `AdamEddahmouni/agent-ready`
   - Workflow: `publish.yml`
   - Allowed action: `npm publish`
4. Click **Create Trust**.
