# @dltech/atlas-agent-host

The process that owns v2 sessions at runtime: claims them from the control plane, wakes their
sandboxes, drives the loop, and publishes live frames.

## Env

Values live in the committed dotenvx tier files `.env.<tier>.enc` at this package's root (production, local).
The private keys are in `.env.keys` (git-ignored, an Atlas Cloud project file mount). A host holds only
`DOTENV_PRIVATE_KEY_PRODUCTION_ENC`. Add a value with
`dotenvx set KEY value -f .env.<tier>.enc -fk .env.keys` in every tier.


| Var                       | Required | Default                                                         |
| ------------------------- | -------- | --------------------------------------------------------------- |
| `DATABASE_URL`            | yes      | —                                                               |
| `DATABASE_DIRECT_URL`     | yes      | —                                                               |
| `REDIS_URL`               | yes      | —                                                               |
| `DAEMON_SECRET`           | yes      | —                                                               |
| `SECRETS_ENCRYPTION_KEY`  | yes      | —                                                               |
| `ATLAS_API_ORIGIN`        | yes      | —                                                               |
| `CLOUDFLARE_API_TOKEN`    | yes      | —                                                               |
| `CLOUDFLARE_ACCOUNT_ID`   | yes      | —                                                               |
| `CLOUDFLARE_ZONE_ID`      | yes      | —                                                               |
| `PREVIEW_DOMAIN`          | no       | `byatlas.dev`                                                   |
| `AGENT_HOST_MAX_SESSIONS` | no       | 25                                                              |
| `AGENT_HOST_DRAIN_MS`     | no       | 270000 (shutdown handoff budget; keep below the platform grace) |
| `ATLAS_SANDBOX_IMAGE`     | no       | `atlas-sandbox:latest`                                          |
| `ATLAS_DAEMON_BUNDLE`     | no       | `apps/daemon/bin/daemon.js` relative to this package            |
| `PORT`                    | no       | 10000 (Render sets it)                                          |
| `TRUSTED_ORIGINS`         | no       | empty: any Origin; else a comma list                            |

`ATLAS_API_ORIGIN` is handed to each sandbox as `ATLAS_CLOUD_URL` (the v1 serve inside it still
calls the API); the host itself calls the API for nothing. `CLOUDFLARE_*` is what the host uses to
mint preview tunnels and DNS routes for `exposePort`.

Missing required vars exit 78 with the names on stderr.

## Deploy (Render)

Build command:

```
bun install --frozen-lockfile && bun run --cwd apps/daemon build
```

Start command:

```
bun run --cwd apps/agent-host start
```

Render env holds only `DOTENV_PRIVATE_KEY_PRODUCTION_ENC` (plus `BUN_VERSION`). Locally:
`bun run --cwd apps/agent-host dev` (needs the api, docker Postgres and `test-redis`).
