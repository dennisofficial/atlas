# @dltech/atlas-agent-host

The process that owns v2 sessions at runtime: claims them from the control plane, wakes their
sandboxes, drives the loop, and publishes live frames.

## Env

Values live in the committed dotenvx tier files `envs/.env.agent_host.<tier>.enc` (production, local).
The private keys are in `envs/.env.keys` (git-ignored, an Atlas Cloud project file mount). A host holds only
`DOTENV_PRIVATE_KEY_AGENT_HOST_PRODUCTION`. Add a value with
`dotenvx set KEY value -f envs/.env.agent_host.<tier>.enc -fk envs/.env.keys` in every tier.


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

Render env holds only `DOTENV_PRIVATE_KEY_AGENT_HOST_PRODUCTION` (plus `BUN_VERSION`). Locally:
`bun run --cwd apps/agent-host dev` (needs the api, docker Postgres and `test-redis`).
