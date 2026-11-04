# @dltech/atlas-agent-host

The process that owns v2 sessions at runtime: claims them from the control plane, wakes their
sandboxes, drives the loop, and publishes live frames.

## Env

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
bun apps/agent-host/src/main.ts
```
