# Release, sandbox-image and update-path inventory (before deleting v1 serve/harness)

Repo: `/atlas/workspaces/atlas/.atlas/worktrees/dennis/v1-retirement-spec` (origin/main of dennisofficial/atlas).
All paths below are relative to that root; line numbers are from that checkout.

Headline: there is exactly **one** release pipeline. It is the `release` job inside `.github/workflows/ci.yml`
(not `release.yml`, which only deploys the API/workers). It cuts tag `tui-v<X.Y.Z>`, and that one release carries
the TUI binaries, the two `atlas-serve` binaries, and — carried forward or freshly built — the Mac dmg/zip/
`latest-mac.yml`. `latest` on GitHub plus `index.json` in R2 are the two switches every updater reads.

---

## 1. Workflows

`.github/workflows/` holds: `automerge.yml`, `catalogue.yml`, `ci-watchdog.yml`, `ci.yml`, `claude-code-version.yml`,
`codex-version.yml`, `release.yml`, `sandbox-image.yml`, `tests-nightly.yml`, `trigger-v2.yml`, `web-ota.yml`.

### 1.1 `ci.yml` (679 lines) — tests, binaries, the release, the Mac build

Triggers: `pull_request`, `push: main`, `workflow_dispatch` (`ci.yml:3-7`). Workflow-level token is read-only;
write scopes live on the `release` job (`ci.yml:9-13`).

| Job                 | Line         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check`             | `ci.yml:20`  | lint/format (`bun run lint` → biome + the `scripts/check-*` guards), typecheck, generated-artifact staleness (api-router, plugin types, plugin manifest/skills)                                                                                                                                                                                                                                                                                              |
| `binaries`          | `ci.yml:84`  | builds the **real** binaries: reach gate `scripts/app-reach.ts --app apps/tui --app apps/serve` (`:113`), `bun run build` in `apps/tui` (`:117`), smoke-runs `./bin/atlas --version` (`:123`), builds `atlas-serve` linux-x64 (`:128`), installs every platform's optional packages (`:133`), then builds `atlas-serve` linux-arm64 only to prove cross-compilation (`:137`). Skips the whole thing when the dependency closure of tui+serve did not change. |
| `web-build`         | `ci.yml:144` | PR-only Next build of `apps/web` (main pushes are covered by `web-ota.yml`)                                                                                                                                                                                                                                                                                                                                                                                  |
| `test`              | `ci.yml:187` | one big incremental `bun test` fan-out with postgres+redis services, plus `bun test ./scripts` and the incremental package's own suite                                                                                                                                                                                                                                                                                                                       |
| `mac-app-rehearsal` | `ci.yml:301` | PR-only unsigned `electron-builder --mac dmg zip --arm64` + `update-manifest.ts --version 0.0.0` (`:339-346`)                                                                                                                                                                                                                                                                                                                                                |
| `ci`                | `ci.yml:366` | aggregation job, the single required status name                                                                                                                                                                                                                                                                                                                                                                                                             |
| `release`           | `ci.yml:402` | **the release** (see 1.2)                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `mac-release`       | `ci.yml:551` | signed/notarized Mac build for a release the `release` job cut **and** only when the app changed                                                                                                                                                                                                                                                                                                                                                             |

`release` job mechanics:
- Gate: `needs: [ci]`, `if: github.ref == 'refs/heads/main' && needs.ci.result == 'success'` (`ci.yml:403-405`);
  concurrency group `release-${{ github.ref }}`, `cancel-in-progress: true` (`:409-411`), so a fresher push
  cancels the older run and re-derives the version.
- **Version decision is a custom script, not semantic-release**: `bun apps/tui/scripts/release-version.ts`
  (`ci.yml:434`). That script (`apps/tui/scripts/release-version.ts:1-55`):
  - lists tags with prefix `tui-v` (`:11-13`, prefix from `apps/tui/src/boot/update-check.ts:23`),
  - takes the highest semver tag as `current` (`latestRelease`, `apps/tui/src/boot/update-check.ts:49-60`),
  - reads commit subjects `prevTag..HEAD` and changed paths (`release-version.ts:15-23`),
  - computes `affectedApps` over `SHIPPED_APP_DIRS` (`packages/core/src/version/release-affected.ts:1`,
    i.e. `apps/tui`, `apps/serve`, `apps/mac`) using the workspace dependency closure (`:52-64`),
  - `nextReleaseVersion` (`packages/core/src/version/release-bump.ts:35-56`): `!`/breaking → minor while
    major is 0 else major; `feat` → minor; `fix` → patch; if neither and no shipped app affected → `null`
    (the job prints `skip=true` and does nothing).
  - emits `mac=true|false` (`release-version.ts:46-47`) — whether `apps/mac` was affected.
- Artifacts built (`ci.yml:436-461`): for `bun-darwin-arm64 bun-darwin-x64 bun-linux-x64`
  → `dist/atlas-<platform>` + `.sha256` (`:445-449`); then `atlas-serve-linux-x64` and
  `atlas-serve-linux-arm64` + `.sha256` (`:451-461`).
- Tag: `tui-v${VERSION}` (`ci.yml:413`, `:478`). **No `v*` and no `serve-v*` tags exist anywhere** —
  grep for `serve-v`/`v*` release tags returns nothing.
- `gh release create tui-v$VERSION` with `--title "atlas v$VERSION" --generate-notes --latest=false
  --target "$TARGET_SHA"` and `--notes-start-tag $PREV_TAG` (`ci.yml:470-481`). Because `--latest=false`, the
  new release is **not** latest yet: the two steps below decide.
- `dispatch sandbox image retag`: `gh workflow run sandbox-image.yml -f release_tag=tui-v$VERSION
  -f release_sha=$TARGET_SHA` (`ci.yml:483-487`).
- "carry the mac files forward and mark latest" — runs when `mac != true` (`ci.yml:500-530`): downloads
  `latest-mac.yml`, `*-mac.zip`, `macos-arm64-Atlas.dmg` from whatever release is currently latest, uploads
  them to the new tag, then `gh release edit "$tag" --latest`. It fails rather than mark latest without them
  (`:514`, `:517-522`). This is the mechanism that makes **every TUI release "latest"** (PR #2797's intent, see
  the comment block at `ci.yml:489-499`).
- Mirror: `scripts/mirror-release.ts tui-v$VERSION --latest` (`ci.yml:534-541`) with the install-worker tier key.
- `mac-release` (`ci.yml:551-679`) runs only when the release job says `mac=true` (`:554`): builds
  signed+notarized dmg and zip, stamps `VERSION="${TAG#tui-v}"` (`:622-623`), runs
  `apps/mac/scripts/update-manifest.ts --version "$VERSION" --dir release` (`:631`), uploads
  `*.dmg *.zip latest-mac.yml`, `gh release edit --latest` (`:655-666`), mirrors (`:668-673`).

Which workflows are gated on `tui-v` tags and why:
- `sandbox-image.yml` `retag` job: `if: github.event_name == 'workflow_dispatch' && startsWith(inputs.release_tag,
  'tui-v')` (`sandbox-image.yml:116`). The comment at `:108-114` says out loud: the release job tags `tui-vX.Y.Z`
  and dispatches here. Its purpose is to pin the Agent37 template (and VCR `latest`) to the image **digest of the
  release commit**, because a sandbox boots the image matching the release it downloads
  (`:135-138`, `:208-221` via `apps/api/scripts/agent37-register-template.ts`).
- `scripts/install-worker/worker.js:190` accepts only `/^tui-v[\w.-]*$/` as a pinned `install.sh` ref.
- `mac-release` derives its app version from the tag (`ci.yml:622`).
- Nothing else keys off the tag name.

How "latest" is chosen (two independent meanings, both must agree):
1. GitHub's _latest release_ flag, set by `gh release edit --latest` (`ci.yml:530` for a TUI-only release,
   `ci.yml:666` for a mac release). `releases/latest/download/<asset>` on github.com resolves through it.
2. The R2 `index.json` `{"latest": "<tag>"}`, written by `scripts/mirror-release.ts` when passed `--latest`
   (`scripts/mirror-release.ts:127-130`), which is what `install.byatlas.io/releases/latest/download/<asset>`
   resolves through (`scripts/install-worker/worker.js:128-146`).

### 1.2 `release.yml` (259 lines) — deployments only, no tags, no binaries

Triggers `push: main` + `workflow_dispatch` (`release.yml:3-6`), concurrency group `release`
(`:11-13`). Jobs:
- `changes` (`:16`) — diff gate for the three workers.
- `api-image` (`:60`) — builds `apps/api/docker/Dockerfile` and pushes `ghcr.io/<owner>/atlas-api:<sha>` and
  `:latest` (`:79-93`). **The daemon bundle is built into this image** (see §3).
- `migrate` (`:95`) — `bun run --cwd apps/api db:migrate:predeploy` (`:114-115`).
- `render-deploy` (`:120`) — `POST https://api.render.com/v1/services/srv-dbuu4tui0phs73ercifg/deploys` with
  the image of this sha (`:127-133`). The Render service id is hardcoded here (`:133`, `:151`) and again in
  `web-ota.yml:121-125` and the `apps/api/scripts/render-deploy-gate.ts` invocations.
- `render-live` (`:136`) → `apps/api/scripts/render-deploy-gate.ts`; `web-live` (`:156`) →
  `apps/web/scripts/vercel-promote-gate.ts`.
- `deploy-preview-worker` (`:174`), `deploy-artifacts-worker` (`:201`), `deploy-install-worker` (`:236`,
  deploys `scripts/install-worker/` = install.byatlas.io).

Nothing in `release.yml` names serve, harness, tui or mac.

### 1.3 `sandbox-image.yml` (221 lines)

Triggers: `push: main` on `infra/sandbox-image/**` (README excluded) and `workflow_dispatch` with
`release_tag`/`release_sha` inputs (`:3-22`).
- `publish` (`:42`): builds `infra/sandbox-image` for `linux/amd64,linux/arm64`, pushes `sha-<7>`, `tree-<12>`
  and `latest` to `ghcr.io/<owner>/atlas-sandbox` (`:89-105`). The tree tag hashes the build context files
  (`:65-80`) and the release whose context matches an existing image reuses it by retagging the digest
  (`:82-87`) so the Agent37 template does not get re-pinned.
- **The "compute-tags path rewrite"**: `sandbox-image.yml:71-74` hashes `git ls-tree HEAD infra/sandbox-image/`
  after `sed`-rewriting the paths to look like `apps/serve/sandbox-image/`, with the comment
  "moving the directory must not rename every tree tag". That is the only surviving `apps/serve` coupling in
  this workflow, and it is deliberate: if the path rewrite is dropped, every future build gets a new tree tag.
- `retag` (`:107`, gated as above): resolves the release commit's amd64 digest, checks/sets the Agent37
  template, pushes the VCR `latest` image, prunes VCR images, registers the template (`:139-221`).
- Header comment `:33-35`: "Serve is not baked in, so nothing about the image is version-specific."

### 1.4 `web-ota.yml` (143 lines) — the Mac app's web payload

Triggers `push: main` on `apps/web/**`, `apps/mac/scripts/**`, `packages/**`, lockfile, `workflow_dispatch`
(`:6-18`). Computes the same version with `apps/tui/scripts/release-version.ts` but only to stamp
`ATLAS_VERSION` (`:51-65`), builds the Next standalone payload, smokes it, packs it, waits for the Render deploy,
then creates/updates the release **tag `web-ota`** with `web-update.json` and `web-*.tar.gz` (`--latest=false`,
`:112-118`), keeps the newest 5 payloads, mirrors with `--prune` (`:135-139`). Independent of `tui-v` and of serve.

### 1.5 Other workflows

`trigger-v2.yml` (`push: main` on `apps/trigger/**`, `packages/**`, …) deploys trigger.dev tasks. `catalogue.yml`,
`claude-code-version.yml`, `codex-version.yml`, `automerge.yml`, `ci-watchdog.yml`, `tests-nightly.yml` are
refresh/janitor/nightly workflows with no release or serve coupling.

---

## 2. How each client finds its download

### 2.1 Sandbox serve install (v1) — done by the launcher, not by the image

The image does **not** bake or fetch serve. The code that downloads it is the sandbox launcher:
- `packages/wire/src/sandbox-serve-install.ts:17-19` — `RELEASE_REPOSITORY = 'dennisofficial/atlas'`,
  `RELEASE_MIRROR = 'https://install.byatlas.io'`.
- Asset name: `atlas-serve-linux-${x64|arm64}` (`:33`, enum at `:10-13`).
- Path: `releases/latest/download/<asset>` when the version is undefined, else
  `releases/download/tui-v<version>/<asset>` (`:21-22`, `:34-38`); mirror first, `github.com` as fallback
  (`:38`, `:43`); `.sha256` sidecar fetched in parallel and verified (`:42-46`).
- Tail shared by every installer: per-process staging file, atomic `mv` onto
  `/opt/atlas/atlas-serve`, then writes `/opt/atlas/atlas-serve.version` and `/opt/atlas/atlas-serve.protocol`
  (= `CHANNEL_PROTOCOL_VERSION`) (`sandbox-serve-install.ts:56-70`).
- Paths: `packages/wire/src/serve-env.ts:58-69` — `SERVE_HOME=/opt/atlas`, binary, `.version`, `.protocol`,
  log `/atlas/home/operational/atlas-serve.log`, `/opt/atlas/atlas-serve.lock`, `/opt/atlas/atlas-serve.token`.
- Callers: `packages/wire/src/sandbox-serve-launch.ts:184-186` (pluggable installer);
  `apps/api/src/api/cloud/github/github-sandbox-wake-boot.ts:108-113` (Vercel resume/boot uses
  `releaseOnlyServeInstaller()`); `apps/api/src/api/cloud/github/github-sandbox-wake-installer.ts:11-21`
  (refuses `dev-` versions over the network); local docker pod path
  `packages/harness/src/cloud/local-pod/serve-install.ts:5-60` (release download) and
  `packages/wire/src/sandbox-serve-upload.ts:26-60` (`isDevServeVersion`, chunked upload of a locally built
  serve, same stage/stamp tail).

"How it matches its client": the version is a **pin carried on the sandbox row**, not a lookup by client build.
`claimSandboxInputSchema.serveVersion` (`packages/wire/src/sandbox-routes-wire.ts:28`) →
`apps/api/src/api/platform/sandboxes/sandboxes.router.ts:42` → `sandboxes.service.ts:37,105` → the row →
`apps/api/src/api/cloud/github/github-sandbox-wake-launch.ts:49` (`serveVersion: row.serveVersion ?? undefined`)
→ `WakeBootArgs.serveVersion` (`github-sandbox-wake-boot.ts:34`, consumed at `:200` as `desiredVersion`) →
`releaseTagOf()` → `tui-v<that version>`. `undefined` means `latest`. The pin is also written from the pod's
own report (`apps/api/src/api/cloud/sandbox-provisioning/thread-pod.service.ts:132`,
`sandbox-boot-steps.ts:46-50` `runningServeVersion`).

Not confirmed / likely dead: the only in-repo producer of `claim.serveVersion` I found is the v1 cloud launcher
`packages/harness/src/cloud/cloud-oauth-sandbox.ts:142` (`client.registerSandbox(args.registration)` with
`serveVersion` from `packages/harness/src/cloud/sandbox-client.ts:94-106`). Nothing under `apps/tui` sends it —
the TUI is a v2 client with no serve. So today most pods very likely boot serve at `latest`; that producer dies
with `packages/harness`.

### 2.2 TUI self-update

- Tag prefix: `RELEASE_TAG_PREFIX = 'tui-v'` (`apps/tui/src/boot/update-check.ts:23`).
- Tag list source: `https://install.byatlas.io/releases/tags` (`:25`, `:92-100`), falling back to
  `https://api.github.com/repos/<repo>/releases?per_page=50` (`:102-125`). The repo comes from the build
  define `ATLAS_RELEASE_REPO` (`apps/tui/scripts/build.ts:21-23`, read in `apps/tui/src/build/info.ts:47-50`;
  set in CI at `ci.yml:441`).
- "Latest" = **highest semver among `tui-v*` tags**, not GitHub's latest flag (`update-check.ts:49-60`,
  `:202-206`). So the update check works even if the `latest` flag were wrong, but it needs the tag prefix.
- Download: `RELEASE_MIRROR_URL = 'https://install.byatlas.io/releases/download'`
  (`apps/tui/src/build/self-update.ts:16`), asset `<mirror>/<tag>/atlas-<os>-<arch>` plus `.sha256`
  (`:151-168`, names in `apps/tui/src/build/self-update-asset.ts:3-8`: `atlas-darwin-arm64`,
  `atlas-darwin-x64`, `atlas-linux-x64`), mirror then `https://github.com/<repo>/releases/download` (`:171-174`).
  Verified against the sidecar, staged as `<execPath>.next` with a `<execPath>.next.version` marker
  (`self-update-asset.ts:10-16`, `self-update.ts:89-118`), applied on `/restart`.

### 2.3 Mac auto-update

- electron-updater, generic provider, feed URL `https://install.byatlas.io/releases/latest/download`
  (`apps/mac/electron-builder.yml:55-61`; targets dmg + zip arm64 at `:45-51`, artifact name
  `macos-arm64-Atlas.dmg` at `:52-54`).
- `latest-mac.yml` is generated by `apps/mac/scripts/update-manifest.ts:15-38` — it names the zip by file name
  and carries its sha512 and size, `version`, `releaseDate`. It is written in the CI job, not by builder
  publishing (`--publish never` at `ci.yml:630`).
- Therefore the _latest_ release must always hold `latest-mac.yml`, the zip that file names, and the dmg. That
  is what `ci.yml:500-530` enforces and why it fails rather than mark latest without them.
- Separately, the Mac app's **web payload** updates from
  `https://install.byatlas.io/releases/download/web-ota/web-update.json`
  (`apps/mac/src/host/web-payload/updater.ts:6-7`), fed by `web-ota.yml`. Independent of `tui-v`.

---

## 3. The v2 daemon: baked, downloaded or built?

Built into the **API image**, served over HTTP, fetched by the boot script. It never touches the release
pipeline.
- Build: `apps/api/docker/Dockerfile:17-19` (`RUN bun run --cwd apps/daemon build`) and `:28`
  (`COPY --from=build /app/apps/daemon/bin/ apps/daemon/bin/`). The build script is
  `apps/daemon/package.json:12` (`bun build --target=bun --outfile=bin/daemon.js`).
- Route: `DAEMON_BUNDLE_ROUTE` served by
  `apps/api/src/agent/http/daemon-bundle.controller.ts:14-40`; logic in
  `apps/api/src/agent/http/daemon-bundle.ts:14-40` (bearer = `daemonToken(secret, sandboxName)`,
  `?version=` pins a bundle generation and answers 409 `mismatch` otherwise).
- Pod side: `infra/sandbox-image/atlas-boot.sh:7-10`, `:101-141` — loops `curl` of `ATLAS_DAEMON_BUNDLE_URL`
  → `/atlas/home/.atlas/daemon/daemon.js`, records its sha256 as `ATLAS_DAEMON_BUNDLE_VERSION`, runs it, and
  restarts it when it exits. Agent37 create passes the URL (`packages/pods/src/sandbox/agent37/agent37-create.ts:40`).
- Other providers put the bundle in the pod from the API's own file
  (`packages/pods/src/env.ts:32` → `apps/daemon/bin/daemon.js`, `packages/pods/src/sandbox/daemon-launch.ts:11`).
- **Conclusion: the daemon does not depend on the serve release pipeline at all.** It ships with every API
  deploy (`release.yml:60`). Deleting serve changes nothing here.

---

## 4. The sandbox image

Directory: `infra/sandbox-image/` — `Dockerfile`, `README.md`, `atlas-boot.sh`, `docker-daemon-up.sh`,
`docker-shim.sh`, `smoke.sh`.

Base and toolchain are irrelevant to serve. The serve-specific / v2-relevant pieces:
- `infra/sandbox-image/Dockerfile:291-293` — `install -d -m 0777 /opt/atlas` with the comment that serve is
  downloaded into it at boot and the session user writes the token/lock/log there. **Serve-only.**
- `infra/sandbox-image/Dockerfile:295-297` — `install -d -m 0777 /atlas` (ATLAS_HOME + workspace clones). **v2
  needs it.**
- `infra/sandbox-image/Dockerfile:299-304` — `COPY atlas-boot.sh /usr/local/bin/atlas-boot` +
  `ENTRYPOINT ["/usr/local/bin/atlas-boot"]`. **v2 needs it.**
- `infra/sandbox-image/atlas-boot.sh` — entire file is v2: spill mounts for `/root`, `/tmp`, `/var/tmp`
  (`:19-58`), bun cache move (`:51-58`), inotify (`:60-61`), disk reserve (`:63-67`), concrete bun resolution
  (`:68-79`), dockerd start with/without bridge modules (`:80-99`), daemon fetch/restart loop (`:101-141`).
  Must stay PID 1 (its header comment `:1-3`; also `apps/api/src/agent/AGENTS.md:52`). **None of it is serve.**
- The `atlas-serve` stamps (`.version`, `.protocol`) are written by the installer
  (`packages/wire/src/sandbox-serve-install.ts:64-69`), documented at `packages/wire/src/serve-env.ts:60-66`;
  the drift probe that reads `.version` lives in the v1 driver
  (`packages/harness/src/cloud/local-pod/driver-provision.ts` / `driver.ts:48,236`). Both go with v1.
- The image no longer bakes serve: `sandbox-image.yml:33-35` and `infra/sandbox-image/README.md` (last
  paragraph: "no versioned Atlas software baked in — `atlas-serve` is downloaded into the sandbox at boot").
- **Stale leftover**: `scripts/sandbox-image/verify-vcr-image.ts:9` still sets
  `BAKE_ID_PATH = 'infra/sandbox-image/atlas-serve.bake-id'`, a file that does not exist in the checkout. Either
  dead code or a broken probe — worth deleting with v1.
- What v2 still needs from the image overall: the toolchain layers, `/atlas` 777, the dockerd shim/daemon
  scripts, `atlas-boot.sh`, the tree-tag/sha-tag publishing, the VCR push and the Agent37 template pin.

---

## 5. Scripts that touch releases, serve or versions

| Path                                                               | Role                                                                                                                                       | Serve coupling                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `apps/tui/scripts/release-version.ts:1-55`                         | computes `version`/`prev_tag`/`mac`/`skip` for the release, also used by `web-ota.yml`                                                     | indirectly via `SHIPPED_APP_DIRS`             |
| `packages/core/src/version/release-bump.ts:35-56`                  | bump rules (custom, no semantic-release)                                                                                                   | none                                          |
| `packages/core/src/version/release-affected.ts:1`                  | `SHIPPED_APP_DIRS = ['apps/tui','apps/serve','apps/mac']` + dependency closure                                                             | **names `apps/serve`**                        |
| `scripts/mirror-release.ts:1-167`                                  | mirrors a GitHub release tag to R2 `atlas-releases`, writes `index.json` `{latest}`, prunes, verifies every URL                            | generic                                       |
| `scripts/install-worker/worker.js:1-210`                           | install.byatlas.io routes: `/`, `/tui-v<version>`, `/releases/latest/download/<name>`, `/releases/download/<tag>/<name>`, `/releases/tags` | generic, `tui-v` regex at `:190`              |
| `scripts/install-worker/deploy.ts`, `README.md`                    | deploy the worker; documents routes                                                                                                        | none                                          |
| `scripts/sandbox-image/prune-vcr-images.ts`, `verify-vcr-image.ts` | VCR image housekeeping                                                                                                                     | `verify-vcr-image.ts:9` names a serve bake-id |
| `scripts/app-reach.ts`                                             | "does this change reach app X" gate used by `ci.yml` binaries/web/mac jobs                                                                 | used with `--app apps/serve` at `ci.yml:113`  |
| `apps/api/scripts/render-deploy-gate.ts`, `render-deploy-of.ts`    | waits for the Render deploy of a commit                                                                                                    | none                                          |
| `apps/web/scripts/vercel-promote-gate.ts`                          | promotes the staged Vercel build                                                                                                           | none                                          |
| `apps/api/scripts/agent37-register-template.ts`                    | pins the Agent37 template to an image digest (used by the sandbox-image retag)                                                             | none                                          |
| `apps/mac/scripts/update-manifest.ts:1-61`                         | writes `latest-mac.yml`                                                                                                                    | none                                          |
| `scripts/check-wire-skew.ts:1-35`                                  | fails a change that breaks `CHANNEL_PROTOCOL_VERSION` for released serve (message at `:31`)                                                | **v1-only guard**                             |
| `scripts/split-guard/rules.ts:41,47,61`                            | package-boundary rules naming `@dltech/atlas-serve` and `apps/serve` as v1 roots                                                           | **names serve**                               |
| `scripts/check-api-image-context.ts:3`                             | API image workspace roots `@dltech/atlas-api`, `@dltech/atlas-daemon`                                                                      | none                                          |
| `install.sh:1-146`                                                 | the public installer; `serve` flavour at `:36-47`, `tui` at `:48-59`, latest path vs `releases/download/tui-v$version` at `:68-75`         | **has a `serve` flavour**                     |

No changelog generator exists: release notes come from `gh release create --generate-notes` with
`--notes-start-tag` (`ci.yml:474-477`), and `packages/core/src/version/clean-release-body.ts` exists for body
cleanup.

---

## 6. CI jobs that build binaries, and which go away

| Job/step                             | Binaries                                                                     | Fate                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml:111-138` `binaries` job      | `apps/tui` binary (host), `atlas-serve` linux-x64, `atlas-serve` linux-arm64 | keep the tui part; delete `:126-138` and drop `--app apps/serve` from `:113` (a serve-only change currently triggers the whole build) |
| `ci.yml:436-449` release build       | `atlas-darwin-arm64`, `atlas-darwin-x64`, `atlas-linux-x64` + `.sha256`      | keep unchanged                                                                                                                        |
| `ci.yml:451-461` release serve build | `atlas-serve-linux-x64`, `atlas-serve-linux-arm64` + `.sha256`               | **delete**                                                                                                                            |
| `ci.yml:478-481` release create      | attaches `../serve/dist/*` (4 files)                                         | **delete the serve args**, keep `dist/*`                                                                                              |
| `ci.yml:615-631` mac-release         | dmg + zip + `latest-mac.yml`                                                 | keep unchanged                                                                                                                        |
| `web-ota.yml:88-118`                 | web payload tar.gz + `web-update.json`                                       | keep unchanged                                                                                                                        |

---

## 7. Render / Vercel / trigger config

- There is **no `render.yaml`** anywhere (`find` for `render*.y*ml` finds nothing). The Render service is
  configured by hand; the workflow addresses it by hardcoded id `srv-dbuu4tui0phs73ercifg`
  (`release.yml:133`, `:151`, `web-ota.yml` gate env). Nothing there names serve.
- `apps/web/vercel.json:1-8` — framework nextjs and deployment gating only. No serve.
- `apps/api/trigger.config.ts:1-17` and `apps/trigger/trigger.config.ts` — trigger.dev project config, `dirs:
  ['./src/trigger']`, bun conditions. No serve.
- The only v1 coupling in deploy config is the API image's own contents (`apps/api/docker/Dockerfile` does not
  build serve) and the sandbox image's retag path rewrite (see §1.3).

---

## 8. Proposed release design once serve is gone

Constraints that must hold, all evidenced above:
1. Installed TUIs update by scanning `tui-v*` tags from `install.byatlas.io/releases/tags` and downloading
   `atlas-<os>-<arch>` + `.sha256` from `releases/download/tui-v<X.Y.Z>/` (`update-check.ts:23,25,49-60,202-206`;
   `self-update.ts:16,151-174`; `self-update-asset.ts:3-8`). **Never change the tag prefix, asset names, sidecar
   naming or the R2 key layout.**
2. Installed Mac apps read `releases/latest/download/latest-mac.yml` from a generic feed and download the zip it
   names (`electron-builder.yml:55-61`; `update-manifest.ts:15-38`).
3. The public installer and the site's download button read `releases/latest/download/<name>` and `/tui-v<v>`
   (`install.sh:68-77`; `install-worker/worker.js:150-196`).
4. `latest` must therefore always hold `latest-mac.yml`, its named zip, and `macos-arm64-Atlas.dmg`.

Proposed design (keep it boring — one release, unchanged tag and URLs):
1. **Trigger unchanged.** `release` job still `needs: [ci]` on `push: main`, with the same
   cancelling concurrency group and the same `release-version.ts`. Do not move to `workflow_run` (the comment at
   `ci.yml:391-401` explains the stale-`head_sha` bug that decision fixes).
2. **Tag naming unchanged: `tui-v<X.Y.Z>`.** Even though only the TUI is left, renaming the tag would break
   every installed binary, the install worker's `/tui-v<version>` route, `install.sh`, the sandbox-image retag
   input, and `mac-release`'s `${TAG#tui-v}`.
3. **Assets:** `atlas-darwin-arm64`, `atlas-darwin-x64`, `atlas-linux-x64`, each with `.sha256`; plus, when the
   Mac app changed, `macos-arm64-Atlas.dmg`, `*-mac.zip`, `latest-mac.yml`.
4. **Keep "every release is latest"** (PR #2797): `--latest=false` at creation, then either the Mac build
   (`ci.yml:666`) or the carry-forward step (`ci.yml:500-530`) sets `--latest`, then
   `mirror-release.ts <tag> --latest` moves `index.json`. Both switches stay in lockstep.
5. **Serve retirement needs a compatibility window.** Two facts collide: `install.byatlas.io/releases/latest/download/atlas-serve-*`
   resolves to whatever `index.json` calls latest, and old TUI builds (and any pod pinned to `latest`) still try
   that URL at first boot (`sandbox-serve-install.ts:33-43`). Choose one, and write the choice down:
   - **A. Carry serve forward, like the Mac files.** For N releases after the cut, copy the last release's
     `atlas-serve-linux-{x64,arm64}` + `.sha256` onto each new tag (a 6-line sibling of `ci.yml:512-529`,
     same fail-loud shape). Cost: 4 assets per release, ~5 lines of YAML. Ends any time by deleting the step.
   - **B. Freeze a serve tag in the mirror.** Publish `tui-v<last-with-serve>` as the final serve-bearing
     release and add a redirect in `scripts/install-worker/worker.js` so
     `/releases/latest/download/atlas-serve-*` answers from that tag (≈10 lines, one test). No per-release cost,
     but the mirror now lies slightly about "latest".
   - **C. Accept the break.** Old clients 404 on their next fresh sandbox. Only correct if no v1 client is
     expected to boot again — the operator is the only user, so this may be acceptable, but it must be a stated
     decision, not an accident.
6. **Drop the release-triggered image retag.** The retag exists so the Agent37 template pins the image of the
   release commit, which only mattered because serve was downloaded per release onto a shared image
   (`sandbox-image.yml:33-35,108-116`). With serve gone, delete the `dispatch sandbox image retag` step
   (`ci.yml:483-487`) and the `retag` job (`sandbox-image.yml:107-221`); keep `publish` and, if the VCR push and
   template pin are still wanted, move them onto the `publish` job's own path-triggered run.
7. **Version bookkeeping.** `SHIPPED_APP_DIRS` becomes `['apps/tui','apps/mac']`
   (`release-affected.ts:1`), so a change that reaches only `packages/harness` no longer cuts a release.
   `release-version.ts`'s `mac=` output and the `mac` job output stay exactly as they are.
8. **Delete the v1-only guards with the code**: `scripts/check-wire-skew.ts` (or drop it from `bun run lint`,
   `package.json:26`), the `apps/serve` and `@dltech/atlas-serve` entries in `scripts/split-guard/rules.ts:41,47,61`,
   the `serve` flavour of `install.sh:36-47`, and the stale
   `scripts/sandbox-image/verify-vcr-image.ts:9` bake-id path. Keep `packages/wire/src/serve-env.ts` only if
   something still reads `SERVE_HOME`; otherwise delete with `packages/wire/src/sandbox-serve-*.ts`.
9. **Do not touch** `release.yml` (API/worker deploys), `web-ota.yml`, `trigger-v2.yml`, `apps/mac/electron-builder.yml`,
   `scripts/mirror-release.ts`, `scripts/install-worker/*` beyond option B.

### Files that change

- `.github/workflows/ci.yml` — delete `:126-138` (serve builds in `binaries`), `:451-461` (release serve build),
  the serve args at `:478-481`, optionally `:483-487` (retag dispatch); keep `:500-541`, `:551-679` untouched;
  drop `--app apps/serve` at `:113`.
- `.github/workflows/sandbox-image.yml` — delete or repurpose `:107-221`; keep `:42-105`.
- `packages/core/src/version/release-affected.ts:1` — two-entry `SHIPPED_APP_DIRS` (and its spec
  `packages/core/src/version/__tests__/release-affected.spec.ts:13,70`).
- `install.sh:12,19,36-47` — remove the `serve` flavour.
- `scripts/split-guard/rules.ts:41,47,61`, `scripts/check-wire-skew.ts` (+ `package.json:26`).
- `scripts/sandbox-image/verify-vcr-image.ts:9` — drop the bake-id path.
- `infra/sandbox-image/Dockerfile:291-293` — option: keep `/opt/atlas` (harmless) or delete with serve.
- `packages/wire/src/{serve-env,sandbox-serve-install,sandbox-serve-launch,sandbox-serve-upload}.ts` and their
  callers in `apps/api/src/api/cloud/github/{github-sandbox-wake-boot,github-sandbox-wake-installer,
  github-sandbox-wake-launch}.ts` — deleted with serve, not with the release design.

### Migration risks, in order of how loudly they break

1. **Old TUI binaries in the wild looking for `tui-v` tags and `atlas-<os>-<arch>` assets.** Any tag rename, any
   asset rename, or dropping the `.sha256` sidecar silently strands every installed binary at
   "update available" that never stages (`update-check.ts:236-261` then `self-update.ts:89-118` both fail).
   Mitigation: keep all four constants frozen; they are the actual public API of this project.
2. **Mac feed breaks if a release becomes latest without Mac files.** `ci.yml:514-522` already fails instead of
   doing that; keep that step verbatim when serve removal touches the release job, or the first serve-less
   release turns `releases/latest/download/latest-mac.yml` into a 404 and installed apps stop updating.
3. **Serve 404 for old clients** (§8.5). Decide A, B or C explicitly.
4. **`index.json` and GitHub's `latest` flag can drift** if only one of `gh release edit --latest` and
   `mirror-release --latest` runs (e.g. the mirror step fails after the flag moved). Today they are adjacent
   steps in the same job and the mirror verifies every URL (`mirror-release.ts:99-120`); keep that adjacency.
5. **Sandbox-image tree tags** are hashed through the `apps/serve/sandbox-image` path rewrite
   (`sandbox-image.yml:71-74`). Deleting the `sed` while "cleaning up serve" renames every tree tag, rebuilds the
   image, re-pins the Agent37 template and marks every live instance outdated. Leave the rewrite alone or change
   it deliberately once.
6. **Version-derivation regression**: if `apps/serve` is removed from `SHIPPED_APP_DIRS` but the serve build steps
   are not, or vice versa, a release can be skipped (`nextReleaseVersion` returns null) while a change shipped —
   the exact failure the `--target $TARGET_SHA` fix was added for (`ci.yml:470-474`).
