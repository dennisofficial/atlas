# src/agent

The agent owns v2 sessions at runtime: claims them from the control plane, wakes their sandboxes,
drives the loop and publishes live frames. It is a module of `apps/api`, `AgentModule`, mounted by
the root `AppModule` beside `ApiModule`; there is no separate app, package or deploy. `src/api`
reaches it only through `index.ts`, and nothing here imports `src/api`.

## Env

Values live in the api's committed dotenvx tier files at `apps/api/.env.<tier>.enc`; this module has
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
| `AGENT_HOST_MAX_SESSIONS`            | no       | 25                                   |
| `AGENT_HOST_PUBLIC_URL`              | no       | `https://agent.byatlas.io`           |
| `ATLAS_SANDBOX_IMAGE`                | no       | `atlas-sandbox:latest`               |
| `ATLAS_DAEMON_BUNDLE`                | no       | `apps/daemon/bin/daemon.js`          |
| `BLOB_READ_WRITE_TOKEN`              | no       | —                                    |
| `VERCEL_OAUTH_CLIENT_ID` / `_SECRET` | no       | —                                    |
| `PORT`                               | no       | 10000 (Render sets it)               |
| `TRUSTED_ORIGINS`                    | no       | empty: any Origin; else a comma list |

`ATLAS_API_ORIGIN` is handed to each sandbox as `ATLAS_CLOUD_URL` (the v1 serve inside it still calls
the API); the agent itself calls the API for nothing. `CLOUDFLARE_*` is what it uses to mint preview
tunnels and DNS routes for `exposePort`. `AGENT_HOST_PUBLIC_URL` seals the MCP OAuth `redirect_uri`,
so production keeps it at `https://agent.byatlas.io`.

Missing required vars exit 78 with the names on stderr.

## Deploy and local dev

`apps/api`'s Render service is the only host; its build, pre-deploy and start commands are in
`apps/api/AGENTS.md`. Render's health check is `GET /healthz`, which this module serves
(`http/health.controller.ts`) and which answers 503 while the session stream drains.
`/mcp-oauth/callback` is the redirect a provider opens; keep the path and the origin.

Locally, `bun run dev` in `apps/api` runs it with the api and needs docker Postgres and `test-redis`:
the agent refuses to start without `REDIS_URL`. Tests run from `apps/api` too — `bun test src/agent`.
