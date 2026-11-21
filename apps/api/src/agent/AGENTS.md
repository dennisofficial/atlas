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

`ATLAS_API_ORIGIN` is handed to each sandbox as `ATLAS_CLOUD_URL`. The v1 serve inside it still calls
the API. The agent itself calls the API for nothing. `CLOUDFLARE_*` is what the agent uses to mint preview
tunnels and DNS routes for `exposePort`. `AGENT_HOST_PUBLIC_URL` seals the MCP OAuth `redirect_uri`,
so production keeps it at `https://api.byatlas.io`.

`AGENT37_TEMPLATE_ID` names the workspace template that `scripts/agent37-register-template.ts`
registers from `ghcr.io/dennisofficial/atlas-sandbox` (name `atlas-sandbox`, `default_port` 47300, the daemon port).
The `retag` job in `.github/workflows/sandbox-image.yml` runs that script on every release with the
`sha-<7>` tag the `publish` job pushed. The template's digest therefore moves together with the image the
Vercel provider gets.
A create hands the instance `ATLAS_DAEMON_BUNDLE_URL` (this host's `/agent/daemon/bundle`). The
image's entrypoint then boots the daemon at PID 1. An Agent37 instance stops when its image's main
command exits, so `atlas-boot.sh` has to stay PID 1. The template's entrypoint must never be set to
a command that returns, or the instance dies and takes every exec with it.
Every Agent37 instance mounts its disk at `/atlas` through `mount_path`, which hides whatever the
image ships in that folder. The image must therefore keep nothing it needs under `/atlas`.
A pod starts at `AGENT37_DISK_GB` and the `pod-disk-grow` schedule grows it to 1.5 times its size
when it is 80% full and no turn is running, up to Agent37's 100 GB ceiling. A grow reboots the vm
and keeps `/atlas`, and the pod is woken again afterwards.

Missing required vars exit 78 with the names on stderr.

## Deploy and local dev

`apps/api`'s Render service is the only host. Its build, pre-deploy and start commands are in
`apps/api/AGENTS.md`. Render's health check is `GET /healthz`, which this module serves
(`http/health.controller.ts`) and which answers 503 while the session stream drains.
`/mcp-oauth/callback` is the redirect a provider opens. Keep the path and the origin.
`GET /agent/daemon/bundle` serves the daemon bundle the host holds at `ATLAS_DAEMON_BUNDLE`. It
authenticates the sandbox with its `DAEMON_TOKEN` and `X-Atlas-Sandbox` header. The Agent37
image's boot loop fetches it on every wake (`apps/serve/sandbox-image/atlas-boot.sh`).

Locally, `bun run dev` in `apps/api` runs it with the api and needs docker Postgres and `test-redis`.
The agent refuses to start without `REDIS_URL`. Tests run from `apps/api` too: `bun test src/agent`.
