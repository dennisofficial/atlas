---
name: atlas-services
description: Declare, start and debug long-running services (dev servers, APIs, watchers) with .atlas/services.yaml, services_ensure and service_start, and hand the operator a public byatlas.dev URL. Use when a task needs a running server, a preview URL, a PORT or PUBLIC_URL, Vite or Next.js host allow-listing, or when a service is crash-looping or not ready.
---

# Atlas services

A service is infrastructure you work against: it stays up while you continue, is restarted when it
crashes, and can carry a public URL. Never run servers in `bash` (`cmd &`, `nohup`): bash has no
URL exposure, and the process is neither supervised nor resumed.

## Declared services

Declare them in `.atlas/services.yaml` at the workspace root, then call `services_ensure`
(optionally `{ names: [...] }`). It starts what is missing, waits for health, and returns
`{ name, status, url?, ready, reason? }` per service. It is idempotent; call it freely before you
need a URL.

```yaml
services:
  web:
    command: bun run dev
    cwd: apps/web
    health: /
    env:
      NODE_ENV: development
    portal: true
  api:
    command: bun run start
    port: 4000
    health: /healthz
```

| Field    | Meaning                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- |
| `command` | Required. Shell command that runs the server.                                           |
| `cwd`    | Working directory, relative to the workspace root unless absolute.                       |
| `port`   | Fixed port. Omitted: a stable free port from 20000-29999 per thread and service name.    |
| `health` | Path starting with `/`; ready on a 2xx/3xx GET. Omitted: ready when the port accepts TCP. |
| `env`    | String map. `PORT`, `PUBLIC_URL`, `ATLAS_THREAD_ID` and the Vite host variable are reserved. |
| `portal` | `true` (or `{ url?, title?, description? }`): publish a public URL for this service.     |

Names are lowercase letters, digits and dashes, at most 32 characters. Only services with `portal`
get a public URL. Entries Atlas rejects are listed in the workspace hint and in the tool reply;
fix the file rather than working around it.

Address services by declared name: `service_stop({ id: "web" })`, `service_restart({ id: "web" })`;
`service_list` shows status and log paths. Declared services are restarted on crashes (backoff 1, 2,
4, 8, 16 seconds) and re-ensured after the sandbox resumes.

## One-off services

`service_start` runs an undeclared process (a database, a scratch server) with the same env
contract and a log file, but no declaration, no health wait and no resume. Pass `exposePort` for a
public URL. Anything the repository will need again belongs in `services.yaml`.

## Environment contract

Every service gets `PORT` and `ATLAS_THREAD_ID`; a service with a public URL also gets `PUBLIC_URL`
and `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` (the URL's hostname). Read `PORT` and `PUBLIC_URL` at
runtime and listen on `$PORT` bound to `0.0.0.0`; never hardcode a port or hostname. URLs look like
`https://<port>-<random>.byatlas.dev`; the original Host is kept and `X-Forwarded-Proto` is added.
`localhost` is the sandbox, not the operator's machine, so always hand over the URL.

## Framework notes

- Vite 6.1 or newer reads `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` itself; no config change. Older
  Vite needs `server.allowedHosts` set from `process.env.PUBLIC_URL`'s hostname.
- Next.js blocks cross-origin dev requests from unknown hosts: set `allowedDevOrigins` in
  `next.config` to the `byatlas.dev` host (derive it from `PUBLIC_URL`), and start it with
  `-p $PORT -H 0.0.0.0`.

## Troubleshooting

- **Not ready** (`ready: false` after the 60 second budget): the URL is still returned. Read the log
  path from `service_list`; check the server binds `0.0.0.0:$PORT`, and that `health` returns 2xx/3xx
  (a 404 or redirect-to-login path fails it; point `health` at a route that answers).
- **Crash-looping** (more than 5 crashes in 120 seconds): Atlas stops restarting it. Read the log
  tail, fix the cause, then `service_restart`.
- **Port collision** (`EADDRINUSE`): drop the fixed `port` so Atlas picks a free one, or stop the
  process holding it (`service_list`, `service_stop`). Never kill by port from bash.
- **Blocked host / "Invalid Host header"**: see the framework notes; the host must be allowed.
- **Wrong or stale URL after changes**: the URL belongs to the port; if `port` changed, ensure again.
