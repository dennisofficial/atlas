# Pods

A **pod** is the external runtime a session runs in: a local Docker container or a Vercel Sandbox.
The **runner** is which of the two hosts it (`ERunner` in `packages/core/src/execution/runner.ts`).
Both runners boot the same `atlas-serve` binary and run the same serve code, so a session in a pod
behaves the same on either. The loop, the transcript and the tools live in serve. The TUI is a
detached client of it over the wire protocol.

This file describes pods as they are on `main`. Why they are shaped this way is in
`docs/decisions/`. Much of the code still says "sandbox" where it means pod
([0001](decisions/0001-pods-not-sandboxes.md)).

## Behind a flag

Pods sit behind the `experimental.pods` setting, default off (`packages/core/src/settings/registry.ts`,
env `ATLAS_EXPERIMENTAL_PODS`). `composeAtlas` reads it once at launch and exposes it as `app.pods`
(`apps/tui/src/composition/compose.ts`), so changing it needs a restart.

- **Off (the default):** sessions run in-process on the host. There is no runner chip, no Atlas
  Cloud sign-in gate and no Docker preflight on send (`apps/tui/src/composition/use-thread-birth.ts`).
  A host thread can still move its tools into Docker with `/container docker`; that is the
  older tool-environment switch, not a pod. Old host threads list as usual. Local `auth.json`,
  `secrets.json` and `settings.json` are read as before.
- **On:** every new thread is born in a pod on its first send, described below.

The TUI keeps in-process sessions as its default because they start instantly and need no
sign-in. The web app is the surface that needs pods, and the pod work below is its foundation
([0013](decisions/0013-pods-behind-a-flag.md)).

Memory is cloud rows in both modes ([0009](decisions/0009-memory-is-rows-behind-tools.md)).

## Birth on first send

With the flag on, launch and `/new` land on an unplaced welcome thread. Nothing is provisioned
yet. Its footer chip shows `pod` (local) or `☁ cloud` (Vercel). Toggling it only changes a stored
preference, `placement.lastBorn`, which is also the default for the next thread
(`apps/tui/src/composition/cloud/born-cloud.ts`, `apps/tui/src/composition/cloud/use-unborn-thread.ts`).

The first send runs, in order (`apps/tui/src/composition/cloud/born-cloud.ts`):

1. The Atlas Cloud sign-in gate. Signed out, the sign-in prompt opens.
2. For Vercel, a check that Vercel credentials are configured.
3. The runner preflight. Local pings the Docker socket; Vercel checks that its token, team and
   project are configured, without contacting Vercel (`apps/tui/src/composition/live-pod.ts`).
4. Project resolution (below).
5. The birth itself, `birthInCloud` (`packages/harness/src/cloud/cloud-birth.ts`), which creates
   the pod, attaches, commits the placement, and records the runner and `projectId` in the thread
   meta.

If any step refuses or fails, the draft goes back into the composer
(`apps/tui/src/composition/draft-put-back.ts`), and the next send tries again. Once born, the
runner is fixed. The chip shows it but no longer toggles. To use the other runner, start a new
thread with `/new`.

With the flag on, the thread list shows only cloud-placed threads; host and docker threads are
hidden, not deleted (`apps/tui/src/composition/cloud/cloud-listing.ts`).

### Project resolution

A pod's workspace comes from a **Project**, a cloud record of a GitHub repo, a base branch and
additional repos (`Project` in `apps/api/prisma/schema.prisma`)
([0010](decisions/0010-projects-resolved-from-origin.md)). At birth the TUI reads the launch
directory's `origin` remote and matches it to one of the user's Projects
(`apps/tui/src/composition/cloud/use-project-resolution.ts`, `packages/harness/src/cloud/project-match.ts`):

- A GitHub remote that matches a Project uses it.
- A GitHub remote with no match prompts to create a Project, prefilled with the repo and its
  default branch.
- No remote, or a remote that isn't GitHub, opens a picker of the user's Projects, which includes
  No workspace.

The `projectId` is stored in the thread meta, and a wake passes the same one back
(`apps/tui/src/composition/cloud/cloud-open.ts`, `apps/tui/src/composition/cloud/cloud-runner.ts`).

## The two runners

| | Local | Vercel |
| --- | --- | --- |
| Driver | `DockerPodDriver`, Docker Engine API over the Unix socket (`packages/harness/src/cloud/local-pod/driver.ts`) | `VercelDriver` over `@vercel/sandbox` (`packages/harness/src/cloud/vercel-driver.ts`) |
| Image | `ghcr.io/dennisofficial/atlas-sandbox:latest`, pulled anonymously (`packages/harness/src/cloud/local-pod/pod-create.ts`) | the `sandbox.image` setting, default `atlas-sandbox:latest` in Vercel's registry |
| Name | `atlas-pod-<24 hex of sha256(threadId)>` (`packages/harness/src/cloud/local-pod/pod-create.ts`) | `atlas-thread-<24 hex of sha256(threadId)>` (`packages/harness/src/cloud/sandbox-names.ts`) |
| Ports | serve and an in-pod ingress (`packages/harness/src/cloud/local-pod/ingress.ts`), both published on `127.0.0.1` (`packages/harness/src/cloud/local-pod/pod-create.ts`) | provider-routed ports (`packages/wire/src/sandbox-sdk.ts`) |
| Resize | live, `POST /containers/<id>/update` | applies on restart |
| Persistence | named volumes, kept across park and wake | a persistent sandbox in `iad1` (`packages/wire/src/sandbox-mount.ts`) |

Serve installs the same way on both. A release build downloads the serve binary matching the
client's version and checks its SHA-256 (`packages/wire/src/sandbox-serve-install.ts`). A dev
build uploads a locally built binary instead (`packages/harness/src/cloud/local-pod/serve-install.ts`,
`packages/wire/src/sandbox-serve-upload.ts`).

## Boot

### What the client puts into a pod

The TUI creates the pod and stages a fresh boot (`packages/harness/src/cloud/local-pod-bridge.ts`,
`packages/harness/src/cloud/local-cloud-bridge.ts`, `packages/harness/src/cloud/local-cloud-bootstrap.ts`):

- **The serve token.** The client generates one per thread and keeps it in its local secrets as
  `sandbox-serve:<threadId>` (`packages/harness/src/cloud/sandbox-attachment.ts`). For a local pod
  the client registers it with `PUT /v1/pod-leases/:threadId` under the operator's Atlas Cloud
  session, before staging and again after the pod is up. The API keeps only its hash
  (`LocalPodLease`). A Vercel pod is registered as a `CloudSandbox` row instead.
- **Environment.** The serve token, thread id, Atlas Cloud URL and `ATLAS_HOME=/atlas/home`
  (`packages/wire/src/serve-env.ts`); an optional pinned model; the decisions, classifier and
  web-search settings and a telemetry id (`apps/tui/src/composition/live-cloud.ts`). A Vercel pod
  also gets the Vercel token, team and project, so serve can publish ports itself.
- **`/atlas/home/bootstrap/workspace-spec.json`**, whose only inputs are the `projectId` and the
  optional model. Its `remoteUrl` and `githubToken` fields are always `null`.
  A local pod stages only once: a resume finds `/opt/atlas/pod-staged` and skips staging
  entirely (`packages/harness/src/cloud/local-pod/pod-staged.ts`).
- **The serve binary**, on dev builds only.

No copy of the laptop's account vault, `secrets.json`, `settings.json`, `mcp.json`, skills,
instructions, git state, local checkout or GitHub token crosses. The settings above travel as
environment variables, and a Vercel pod gets its Vercel credentials the same way. The user layer
reaches a pod only through the `atlas push` bundle
([0011](decisions/0011-explicit-atlas-push.md)).

### What serve does, in order

1. **Listen.** Serve starts its token-authenticated listener before anything else, and
   `GET /v1/health` reports `booting: true` (`apps/serve/src/start-serve.ts`,
   `apps/serve/src/serve-boot-listener.ts`).
2. **Pull the Project and clone.** With a `projectId`, serve calls
   `GET /v1/projects/:projectId/workspace`, which returns the repo, base branch, additional repos
   and a clone token the API brokers from the user's GitHub connection
   (`apps/serve/src/project-workspace-spec.ts`). A 401 is retried every 2 s for up to 60 s, which
   covers a lease that is still registering. Serve clones the repo with `--branch <baseBranch>`,
   clones the additional repos beside it, and strips the token from each `origin`
   (`apps/serve/src/materialize-workspace.ts`, `apps/serve/src/clone-repo.ts`). A failed clone,
   an additional repo included, fails the workspace, and serve then refuses turns. With no
   `projectId` there is no clone.
3. **Prepare the environment.** Git credentials, GitHub known hosts, `mise install` when the repo
   has a tool-versions file, `.atlas/sandbox-setup.sh` when present, and a Docker probe
   (`apps/serve/src/environment-profile.ts`). A failed step is reported and boot carries on.
4. **Git access.** `GH_TOKEN` and git credential config from the brokered token
   (`apps/serve/src/git-access-env.ts`).
5. **SSH signing key.** `GET /v1/ssh-signing-key`, one 10 s attempt. Serve writes the key to
   `/atlas/home/ssh-signing-key` and sets `gpg.format=ssh`, `user.signingkey`, `commit.gpgsign`,
   `tag.gpgsign`, the user's GitHub name and email, and `gpg.ssh.allowedSignersFile`
   (`apps/serve/src/signing-key-env.ts`). If the lease fails, boot continues without installing
   the signing configuration ([0006](decisions/0006-ssh-signing-key-replaces-gpg.md)).
6. **Accounts, settings and secrets.** `applyCloudState` fetches `GET /v1/account-lease`,
   `GET /v1/settings` and `GET /v1/secrets` concurrently under one 60 s deadline. It writes the
   pod's `auth.json` vault, `secrets.json` and `settings.json` under `/atlas/home`
   (`apps/serve/src/cloud-state.ts`). The account lease blanks OAuth refresh tokens but keeps the
   current access token and its expiry. Secrets named `sandbox-serve:*` or `mcp-oauth:*` are
   client-held and skipped. On failure serve logs it and boots with whatever is on disk.
7. **`atlas push` bundle.** `GET /v1/published-bundles/current` returns the latest version the
   user published and a presigned download URL. Serve checks the size and SHA-256, then installs
   only skill, `ATLAS.md` and `mcp.json` entries (`apps/serve/src/published-bundle.ts`). It is
   the only source of the user layer in a pod. No bundle is a no-op. This runs on every boot, so
   a wake picks up a newer version ([0011](decisions/0011-explicit-atlas-push.md)).
8. **Thread meta.** A fresh pod writes its thread meta with the `projectId`, and a local pod stamps
   `runner: local` (`apps/serve/src/serve-boot.ts`).
9. **Compose.** Serve composes the shared harness with the pod's serve token as its Atlas Cloud
    credential (`apps/serve/src/compose-serve.ts`), then hands its handlers to the listener and
    arms the idle timer (`apps/serve/src/serve-boot-finish.ts`). On a Vercel pod, composition
    also starts the user-layer sync (below).

Two pulls happen after boot, on use:

- **Memory.** The memory tools `read_memory`, `write_memory`, `edit_memory` and `delete_memory`
  talk to `/v1/memories` through `CloudMemoryPort` (`packages/harness/src/memory/cloud-memory-port.ts`).
  A before-turn hook loads the index once and again after a failed load, and core renders it into
  the system prompt (`packages/harness/src/hooks/load-memory.ts`, `packages/core/src/memory/index-render.ts`).
  There are no memory files in a pod.
- **OAuth access tokens.** On a model call with an OAuth account, the pod uses the access token
  it already holds while it is fresh, which starts as the one from the account lease. When it is
  stale or rejected, the pod leases a new one with
  `POST /v1/oauth-connections/:connectionId/access-token`. Only the API holds the refresh token
  and refreshes (`packages/harness/src/credentials/cloud-managed-credential-port.ts`)
  ([0005](decisions/0005-api-owns-oauth-tokens.md)).

MCP server config reaches a pod through the bundle, not through `/v1/mcp-servers`,
which is session-only.

The user-layer sync engine (`/v1/user-files`, skills and instructions) differs by runner. A local
pod gets `ATLAS_POD_NAME`, and the binding chooses a no-op whenever it is set
(`packages/harness/src/composition/user-layer-sync-binding.ts`). A Vercel pod has no
`ATLAS_POD_NAME`, so it binds the real engine with its serve token and syncs. Signed-in host
sessions use it too.

### The TUI's own stores in pod mode

With the flag on and the user signed in, the TUI's account, secret and user-settings stores read
and write Atlas Cloud instead of local files. The switch is one argument, `cloudState: pods`,
passed into `composeHarness` (`packages/harness/src/composition/cloud-state-binding.ts`,
`packages/harness/src/container/register-cloud-backed-stores.ts`). Some things stay local:

- secrets named `sandbox-serve:*` and `mcp-oauth:*`
  (`packages/harness/src/cloud/secrets-store-proxy.ts`);
- settings on the Appearance, Experimental and Hidden pages, which include `experimental.pods`
  and `placement.lastBorn` (`packages/harness/src/cloud/cloud-user-settings-store.ts`);
- everything, while signed out.

The cloud stores start empty, and nothing is imported from the local files
([0012](decisions/0012-cloud-state-starts-empty.md)).

## Security model

**The local pod boundary** ([0003](decisions/0003-local-pod-security-boundary.md)). `podCreateBody`
(`packages/harness/src/cloud/local-pod/pod-create.ts`) creates the container with
`Privileged: true`, so Docker can run inside it. Its only mounts are its own two named volumes:
`<pod>-workspace` on `/atlas/workspaces` and `<pod>-docker` on `/var/lib/docker`. It never mounts
the host Docker socket or a host path, and its ports publish on `127.0.0.1` only. Memory is a
reservation of 2 GiB per vCPU with no hard cap.

**Pod tokens on the API.** `SessionOrSandboxGuard` hashes the bearer and looks it up in both
`LocalPodLease` and `CloudSandbox` (`apps/api/src/api/platform/sessions/session-or-sandbox.guard.ts`,
`apps/api/src/api/platform/sandboxes/sandboxes.service.ts`). The two kinds of pod are different
principals.

A local pod's lease token is accepted only on routes marked `@PodReachable()`
(`apps/api/src/_core/decorators/pod-reachable.decorator.ts`) and gets 403 everywhere else, its own
`:threadId` routes included. On those routes it acts as the lease's owner. The pod-reachable routes:

- `GET /v1/projects/:projectId/workspace`
- `GET /v1/published-bundles/current`
- `GET /v1/settings`, `GET /v1/secrets`, `GET /v1/account-lease`
- `POST /v1/oauth-connections/:connectionId/access-token`
- `GET /v1/ssh-signing-key`
- `/v1/memories`, reads and writes

For a local pod, memory is the only writable store. Writes to settings, secrets, accounts,
Projects, bundles and the signing key need a user session from either kind of pod.

A Vercel pod's token is a `CloudSandbox` principal. It reaches every route above (each also
carries `@SandboxReachable()`), routes scoped to its own thread family, and other
`@SandboxReachable()` routes, which include writes to `/v1/user-files`
(`apps/api/src/api/cloud/user-files/user-files.controller.ts`).

**Ownership and the reaper** ([0007](decisions/0007-pod-home-label.md)). Each pod and its volumes
carry the labels `atlas-pod.thread`, `atlas-pod.role=pod` and `atlas-pod.home`, the last being a
SHA-256 digest of the Atlas home path. At boot, with the flag on, the TUI reaps orphans:
`reapOrphanPods` (`packages/harness/src/cloud/local-pod/reaper.ts`, wired from
`apps/tui/src/composition/live-pod.ts`) lists only pods whose home label matches its own. It
destroys a pod, volumes included, only when this home's thread store has no such thread. A pod
without the home label is never reaped, so prod `atlas` and `atlas-dev` can share one Docker
daemon.

## Lifecycle

- **Birth** happens on the first send, as above. Not at launch and not on `/new`.
- **Park.** Serve parks itself after 5 minutes with no turn, child, shell or pending input,
  whether or not a client is attached. Running services change that: while a client is attached
  the pod does not park, and with no client it parks after 30 idle minutes
  (`apps/serve/src/idle-stop.ts`, `serveIdleDue` in `packages/core/src/execution/lifecycle.ts`).
  Parking records a `parked` event and a checkpoint, closes attached sockets, then stops the
  runtime (`apps/serve/src/serve-lifecycle.ts`, `apps/serve/src/sandbox-park.ts`). A local pod's
  container exits and is kept with its volumes. A Vercel pod is stopped and keeps its persistent
  state.
- **Wake.** Waking means the TUI calls the bridge's create again, which resumes the same pod by
  name (`apps/tui/src/composition/cloud/cloud-runner.ts`). Opening a parked thread whose
  transcript is on disk renders it first; when the pod reports itself parked, the open does not
  wake it, and the next send does (`apps/tui/src/composition/cloud/cloud-open.ts`,
  `packages/harness/src/cloud/remote-turn-runner.ts`). A local pod reports no park checkpoint
  (`packages/harness/src/cloud/local-pod-bridge.ts`), so opening its thread wakes it in the
  background. A thread with no local transcript wakes before it opens. Serve boots again from
  step 1; a workspace that is already cloned is kept.
- **Detached work.** A turn runs in serve whether or not a client is attached. Closing the TUI
  drops only the socket, and serve logs the execution as preserved
  (`apps/serve/src/socket-session.ts`, `apps/serve/src/turn-driver.ts`). A pod with services and
  no client stays up for 30 idle minutes.
- **Destroy** removes the container and both volumes (`DockerPodDriver.destroy`). The reaper
  calls it; parking never does.
