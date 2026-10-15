# CI/CD

Two GitHub Actions workflows plus Dependabot, all in `.github/`. Nothing deploys automatically and no repository secrets are required.

## 1. Continuous integration – `.github/workflows/ci.yml`

**Triggers:** pushes to `main`, `feature/**`, `fix/**`, `chore/**`; pull requests into `main`; manual run (`workflow_dispatch`).
**Permissions:** `contents: read` only. **Concurrency:** a newer run on the same ref cancels the older one.

| Job (check name)                         | Runner         | Steps                                                                                                                                                                                                                             | What a green result proves                                                                                                                                                  |
| ---------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Lint, format, build & tests (Linux)`    | `ubuntu-24.04` | `npm ci --ignore-scripts` (Electron binary skipped) → `npm run lint` → `npm run format:check` → `npm run build` → `npm run test:fresh` → `npm audit` (report only)                                                                | Code lints with 0 errors, is Prettier-formatted, all three bundles compile, and the four SQL simulation suites pass on a freshly bootstrapped database with Linux `sqlite3` |
| `Windows build, tests & packaging check` | `windows-2025` | full `npm ci` (incl. `electron-builder install-app-deps`) → `npm run build` → `npm run test:fresh` with the bundled `sqlite3.exe` → `electron-builder --win --dir` (unsigned, no installer) → check `HeroMarket-POS.exe` metadata | The app packages on Windows with the shipped binaries and the executable carries the HeroMarket product name                                                                |
| `Docker validation image`                | `ubuntu-24.04` | Buildx build of `Dockerfile` (GitHub Actions layer cache, nothing pushed) → `docker run` (lint + format + build + fresh tests as non-root)                                                                                        | The reproducible image still builds and passes (`DOCKER.md`)                                                                                                                |

Not covered by CI (by design or not yet possible): the Electron UI itself, printing, PDF generation and the scripted browser QA. Those are verified manually or with the CDP scripts (`TESTING_AND_KNOWN_ISSUES.md`).

### Dependency audit

`npm audit --omit=dev --audit-level=high` runs on every Linux job and writes its output to the job summary. It is **report-only** (`continue-on-error`) because the remaining advisories are in Electron 39 and need a major upgrade, which is tracked in `SECURITY_AND_RELEASE.md` §4 and will arrive as a Dependabot pull request. The job stays green; read the audit result in the run's summary page. Make the step blocking (remove `continue-on-error`) once the Electron upgrade has landed.

## 2. Release – `.github/workflows/release.yml`

**Triggers:** pushing a tag `vX.Y.Z`, or a manual run with an existing tag.
**Permissions:** `contents: read` by default; only the final `draft-release` job gets `contents: write`.

1. **build-windows** (`windows-2025`): check out the tag → fail unless the tag equals `v` + `package.json` version → `npm ci` → lint → `npm run test:fresh` → generate a clean first-run database (`init-dev-db.js --release-seed`: schema + one `admin` account, no sample data) → `npm run build:win -- --publish never` with code-signing auto-discovery disabled → write `SHA256SUMS.txt` → upload the installer, blockmap, `latest.yml` and checksums as a workflow artifact (30 days).
2. **draft-release** (`ubuntu-24.04`): download that artifact and create a **draft** GitHub Release for the tag (or refresh the assets of an existing draft). It refuses to touch a release that is already published.

A maintainer reviews the draft, tests the installer on a Windows machine, and publishes it by hand. Every push to a branch does **not** produce a release, and nothing is published automatically.

### Cutting a release

```bash
git switch -c chore/release-1.4.0 main
npm version 1.4.0 --no-git-tag-version          # updates package.json + package-lock.json
git commit -am "chore(release): v1.4.0"
git push -u origin chore/release-1.4.0          # open a PR into main, wait for green CI, merge
git switch main && git pull
git tag -a v1.4.0 -m "HeroMarket POS 1.4.0" && git push origin v1.4.0
```

The tag push starts the release workflow. Open the draft release on GitHub, test the installer, then publish it.

## 3. Dependabot – `.github/dependabot.yml`

| Ecosystem      | Schedule                        | Notes                                                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm            | weekly (Monday), max 5 open PRs | Minor/patch updates grouped separately for runtime and development dependencies; majors arrive one PR each. Major bumps of `react`, `react-dom` and `vite` are ignored (they need a planned migration). Electron majors are **not** ignored because Electron 39 has open security advisories. |
| github-actions | weekly                          | Keeps the pinned action SHAs current                                                                                                                                                                                                                                                          |
| docker         | monthly                         | Updates the digest-pinned Node base image                                                                                                                                                                                                                                                     |

Dependabot only opens pull requests; each one runs CI and is merged by a person.

## 4. Supply-chain choices

- Every third-party action is pinned to a full commit SHA with the version in a comment:

  | Action                       | Version | SHA                                        |
  | ---------------------------- | ------- | ------------------------------------------ |
  | `actions/checkout`           | v7.0.1  | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
  | `actions/setup-node`         | v7.0.0  | `820762786026740c76f36085b0efc47a31fe5020` |
  | `actions/upload-artifact`    | v7.0.1  | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
  | `actions/download-artifact`  | v8.0.1  | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` |
  | `docker/setup-buildx-action` | v4.4.1  | `f87e5991a6d7451dcb8d9637bfbc97413f497069` |
  | `docker/build-push-action`   | v7.4.0  | `c3c9e263c25d99ce0380d002d59b67737d91b0dc` |

- `persist-credentials: false` on every checkout; the only token use is `github.token` in the draft-release job.
- Installs use `npm ci` against the committed lockfile; npm is cached by `setup-node`.
- No secrets are configured or referenced. Code signing is optional and documented in `SECURITY_AND_RELEASE.md`.

## 5. Branch protection (recommended, currently unavailable)

GitHub only allows branch protection and rulesets on private repositories for paid plans. For `Youssef2508/hero-market`, the API currently returns _"Upgrade to GitHub Pro or make this repository public to enable this feature"_ (HTTP 403). Until the plan changes, the workflow relies on discipline:

- work on branches and merge into `main` only through pull requests whose CI checks are green;
- never force-push `main`.

After upgrading, protect `main` with: require a pull request before merging; require the status checks `Lint, format, build & tests (Linux)`, `Windows build, tests & packaging check` and `Docker validation image`; require branches to be up to date; block force pushes and deletions.

## 6. Cost note

Private repositories consume GitHub Actions minutes from the account's monthly allowance, and Windows runners are billed at a higher rate than Linux. If minutes run short, restrict the `windows` job to pull requests and `main` (edit its `if:`), not every feature-branch push.

## 7. Verification states

When reporting CI status, keep these separate:

1. **Validated locally** – YAML parses, commands run on a developer machine.
2. **Pushed** – `git push` succeeded and GitHub shows the commit.
3. **Executed** – GitHub started the workflow run.
4. **Passed** – each job finished green. Only this state means CI works.
