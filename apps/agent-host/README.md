# @dltech/atlas-agent-host

The process that owns v2 sessions at runtime: claims them from the control plane, wakes their
sandboxes, drives the loop, and publishes live frames.

## Env

Values live in the committed dotenvx tier files `.env.<tier>.enc` at this package's root (production, local).
The private keys are in `.env.keys` (git-ignored, an Atlas Cloud project file mount). A host holds only
`DOTENV_PRIVATE_KEY_PRODUCTION_ENC`. Add a value with
`dotenvx set KEY value -f .env.<tier>.enc -fk .env.keys` in every tier.


| Var                       | Required | Default                                              |
| ------------------------- | -------- | ---------------------------------------------------- |
| `DATABASE_URL`            | yes      | —                                                    |
| `REDIS_URL`               | yes      | —                                                    |
| `AGENT_HOST_TOKEN`        | yes      | —                                                    |
| `DAEMON_SECRET`           | yes      | —                                                    |
| `ATLAS_API_ORIGIN`        | yes      | —                                                    |
| `AGENT_HOST_MAX_SESSIONS` | no       | 25                                                   |
| `ATLAS_SANDBOX_IMAGE`     | no       | `atlas-sandbox:latest`                               |
| `ATLAS_DAEMON_BUNDLE`     | no       | `apps/daemon/bin/daemon.js` relative to this package |

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
