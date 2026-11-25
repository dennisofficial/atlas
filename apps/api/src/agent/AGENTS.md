# src/agent

The agent owns v2 sessions at runtime. It claims them from the control plane, wakes their sandboxes,
drives the loop and publishes live frames. It is a module of `apps/api`, `AgentModule`, mounted by
the root `AppModule` beside `ApiModule`. There is no separate app, package or deploy. `src/api`
reaches it only through `index.ts`, and nothing here imports `src/api`.

## Env

Values live in the api's committed dotenvx tier files at `apps/api/.env.<tier>.enc`. This module has
no tiers of its own. A service holds only `DOTENV_PRIVATE_KEY_PRODUCTION_ENC`. Add a value with
`dotenvx set KEY value -f apps/api/.env.<tier>.enc -fk apps/api/.env.keys` in every tier.

| Var                                  | Required | Default                              |
| ------------------------------------ | -------- | ------------------------------------ |
| `DATABASE_URL`                       | yes      | —                                    |
| `DATABASE_DIRECT_URL`                | yes      | —                                    |
| `REDIS_URL`                          | yes      | —                                    |
| `DAEMON_SECRET`                      | yes      | —                                    |
| `SECRETS_ENCRYPTION_KEY`             | yes      | —                                    |
| `ATLAS_API_ORIGIN`                   | yes      | —                                    |
| `CLOUDFLARE_API_TOKEN`               | yes      | —                                    |
| `CLOUDFLARE_ACCOUNT_ID`              | yes      | —                                    |
| `CLOUDFLARE_ZONE_ID`                 | yes      | —                                    |
| `PREVIEW_DOMAIN`                     | no       | `byatlas.dev`                        |
| `AGENT_HOST_PUBLIC_URL`              | no       | `https://api.byatlas.io`             |
| `ATLAS_SANDBOX_IMAGE`                | no       | `atlas-sandbox:latest`               |
| `ATLAS_DAEMON_BUNDLE`                | no       | `apps/daemon/bin/daemon.js`          |
| `BLOB_READ_WRITE_TOKEN`              | no       | —                                    |
| `VERCEL_OAUTH_CLIENT_ID` / `_SECRET` | no       | —                                    |
| `PLATFORM_VERCEL_TOKEN`              | no       | —                                    |
| `PLATFORM_VERCEL_TEAM_ID`            | no       | —                                    |
| `PLATFORM_VERCEL_PROJECT_ID`         | no       | —                                    |
| `AGENT37_API_KEY`                    | no       | —                                    |
| `AGENT37_TEMPLATE_ID`                | no       | —                                    |
| `AGENT37_CPU`                        | no       | 2                                    |
| `AGENT37_MEMORY_GB`                  | no       | 4                                    |
| `AGENT37_DISK_GB`                    | no       | 20                                   |
| `PORT`                               | no       | 10000 (Render sets it)               |
| `TRUSTED_ORIGINS`                    | no       | empty: any Origin; else a comma list |

`ATLAS_API_ORIGIN` is handed to each sandbox as `ATLAS_CLOUD_URL`. The agent itself calls the API for
nothing. `CLOUDFLARE_*` is what the agent uses to mint preview
tunnels and DNS routes for `exposePort`. `AGENT_HOST_PUBLIC_URL` seals the MCP OAuth `redirect_uri`,
so production keeps it at `https://api.byatlas.io`.

`AGENT37_TEMPLATE_ID` names the workspace template that `scripts/agent37-register-template.ts`
registers from `ghcr.io/dennisofficial/atlas-sandbox` (name `atlas-sandbox`, `default_port` 47300, the daemon port).
The `publish` job in `.github/workflows/sandbox-image.yml` runs that script on the run that pushes a
new image digest, pinning the digest it just published. The template's digest therefore moves together
with the image the Vercel provider gets, and a run whose image is identical re-pins nothing.
A create hands the instance `ATLAS_DAEMON_BUNDLE_URL` (this host's `/agent/daemon/bundle`). The
image's entrypoint then boots the daemon at PID 1. An Agent37 instance stops when its image's main
command exits, so `atlas-boot.sh` has to stay PID 1. The template's entrypoint must never be set to
a command that returns, or the instance dies and takes every exec with it.
Every Agent37 instance mounts its disk at `/atlas` through `mount_path`, which hides whatever the
image ships in that folder. The image must therefore keep nothing it needs under `/atlas`.
Writes outside `/atlas` share a 10 GB OS layer that Agent37 neither measures nor grows, so
`atlas-boot.sh` overlays `/root`, `/tmp` and `/var/tmp` onto `/atlas`, and the daemon home is
`/atlas/home/.atlas/daemon`. The bun cache is a plain folder, `/atlas/.atlas/bun-cache`
(`BUN_INSTALL_CACHE_DIR`), not an overlay: bun hardlinks only within one mount, and an overlay cache
made every worktree install a full copy that filled `/atlas` faster than a grow could follow.
The boot also keeps a 512 MiB `disk-reserve` file in the daemon home. The daemon deletes it on its
first `ENOSPC`, so a full disk still journals the calls that free space.
A pod starts at `AGENT37_DISK_GB`. The `pod-disk-grow` schedule runs every minute on Agent37's
`disk_bytes` metric. It doubles the disk at 70% full when no turn is running, and at once when the
disk is urgent (90% full, or less than 15% and 2 GB free), up to Agent37's 100 GB ceiling. A grow
reboots the vm and keeps `/atlas`, and the pod is woken again afterwards. A pod already at that
ceiling gets one inbox nudge at 85% full and another at 95%, telling the agent to free space; the
level is kept in the instance metadata and re-arms below 80%.
A container that crash-loops (logs `health.running` false, `restart_count` 3 or more) while its
instance reads `running` is repaired with Agent37's `update`, which resets the OS layer. Sleep and
wake both check for this, and both wait out a transition such as `updating` after a resize.

Missing required vars exit 78 with the names on stderr.

## Deploy and local dev

`apps/api`'s Render service is the only host. Its build, pre-deploy and start commands are in
`apps/api/AGENTS.md`. Render's health check is `GET /healthz`, which this module serves
(`http/health.controller.ts`) and which answers 503 while the session stream drains.
`/mcp-oauth/callback` is the redirect a provider opens. Keep the path and the origin.
`GET /agent/daemon/bundle` serves the daemon bundle the host holds at `ATLAS_DAEMON_BUNDLE`. It
authenticates the sandbox with its `DAEMON_TOKEN` and `X-Atlas-Sandbox` header. The Agent37
image's boot loop fetches it on every wake (`infra/sandbox-image/atlas-boot.sh`).

Locally, `bun run dev` in `apps/api` runs it with the api and needs docker Postgres and `test-redis`.
The agent refuses to start without `REDIS_URL`. Tests run from `apps/api` too: `bun test src/agent`.
