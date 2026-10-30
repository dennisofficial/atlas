# Atlas services

A service is infrastructure you work against: it stays up while you continue, is restarted when it
crashes, and can carry a public URL. Never run servers in `bash` (`cmd &`, `nohup`): bash has no
URL exposure, and the process is neither supervised nor resumed.

## Declared services

Declare them in `.atlas/services.yaml` at the workspace root, then call `service_start({ name })` for one
service or `services_ensure` (optionally `{ names: [...] }`) for all or several. It starts what is missing, waits for health, and returns
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
    portals:
      - url: /docs
        title: Docs
  api:
    command: bun run start
    port: 4000
    health: /healthz
    setup:
      - bun run db:migrate
    env:
      WEB_ORIGIN: ${services.web.publicUrl}
```

| Field    | Meaning                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- |
| `command` | Required. Shell command that runs the server.                                           |
| `cwd`    | Working directory, relative to the workspace root unless absolute.                       |
| `port`   | Fixed port. Omitted: a stable port from 20000-29999 derived from the service name alone. |
| `health` | Path starting with `/`; ready on a 2xx/3xx GET. Omitted: ready when the port accepts TCP. |
| `env`    | String map. `PORT`, `PUBLIC_URL`, `ATLAS_THREAD_ID` and the Vite host variable are reserved. |
| `setup`  | List of shell commands run in `cwd` once per service before its first start.             |
| `portal` | `true` (or `{ url?, title?, description? }`): publish a public URL for this service.     |
| `portals` | Extra links `{ url, title, description? }`; a `/` path resolves against the public URL. |

Names are lowercase letters, digits and dashes, at most 32 characters. Only services with `portal`
get a public URL. Entries Atlas rejects are listed in the workspace hint and in the tool reply;
fix the file rather than working around it.

### Setup

`setup` commands run in order, in the service's `cwd`, once per service before its first start.
They do not rerun on a crash restart or a manual restart. A failing command fails that ensure and
the service does not start; fix the command and ensure again. Put repeatable seeding and migrations
here.

### Environment references

An `env` value can point at another declared service:

- `${services.<name>.url}`: the internal URL, `http://127.0.0.1:<port>`. Use it for server-to-server calls.
- `${services.<name>.publicUrl}`: the public portal URL. The target must declare a `portal`.
- `${services.<name>.port}`: the port number.

Dependencies start first and each service is healthy before its dependents start. A reference to a
missing service, a `publicUrl` without a portal, or a cycle is rejected before anything starts.

### Stale services and restarts

A service is stale when its own declaration (command, cwd, port, health, env, setup, portals) changed
since its running instance started. Other edits to the file do not touch it. `services_ensure`
restarts stale services from the current declaration and reports them as `restarted`. Ports come
from the service name alone, so a restart keeps the same port and URL.

`service_restart` of a declared service always re-reads `.atlas/services.yaml`. When the declaration
was removed or is invalid the restart fails and the running instance stays up.

`service_start({ name })` on a declared name with no command runs its declaration (setup, dependencies,
health, URL), like `services_ensure`; adding `command`, `workdir`, `port` or `exposePort` is refused.

### Operator controls

The web Details sidebar and the TUI list every declared service with its state (stopped, starting,
running, stale, failed, crash-looping) and its links. Start, Stop and Restart there call the same
operations as `services_ensure`, `service_stop` and `service_restart`. Atlas watches the file, so
edits show up in those lists immediately.

Address services by declared name: `service_stop({ id: "web" })`, `service_restart({ id: "web" })`;
`service_list` shows status and log paths. Declared services are restarted on crashes (backoff 1, 2,
4, 8, 16 seconds) and re-ensured after the sandbox resumes.

## Writing a good services.yaml

Use this when the user asks for previews, or the repo has no file or a poor one. Goal: every dev app
starts with one press of play or one `service_start({ name })`, and previews work first time.

1. **Discover.** Read workspace `package.json` `dev` scripts (every monorepo member), `Procfile`,
   docker-compose files, the README's getting-started section and framework configs. List every
   long-running dev server and every infra dependency (Postgres, Redis...).
2. **One service per long-running dev process.** Skip desktop/TUI apps, one-shot scripts, and tools
   that hold credentials (never put those behind a public portal).
3. **Dev mode only.** Run the project's own dev script in watch/HMR mode (`bun run dev`,
   `npm run dev`, `vite`, `next dev`). Never build-then-start or production output
   (`next build && next start`, `node dist`): slow, no reload, hides dev errors. Build-then-serve
   belongs in CI.
4. **Keep commands simple.** Prefer the package's dev script over calling the tool directly. If the
   script hard-codes a port, change the script to honor `$PORT` with the old default rather than
   bypass it.
5. **Listen on `$PORT`, bound to `0.0.0.0`.** Browser-facing apps get a `portal`; backends the browser
   calls get one too; databases don't.
6. **`health`**: a cheap path that answers only when the app is ready (`/`, `/health`); with no HTTP,
   omit it and declare `port` for TCP.
7. **`setup`** for idempotent prep (install, migrate, seed). It runs once per service per session
   before first start.
8. **Infra as services.** Run it in the foreground (`docker compose up postgres`, not `-d`) so
   supervision and stop work; declare `port` for TCP health.
9. **Wire dependencies with env references** (`${services.api.url}`, `${services.web.publicUrl}`);
   they also order startup. Point apps at public URLs where the browser needs them, and fix allowed
   hosts / CORS / cookie domains in the app config, not with hacks.

    A dev server that rejects unknown hosts breaks HMR behind a portal even when the page loads.
    Atlas sets `PUBLIC_URL` (and `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`, which Vite reads on its
    own) for every service with a portal. Next.js reads neither, so `next.config` must add the
    `PUBLIC_URL` hostname to `allowedDevOrigins`:

    ```ts
    const publicUrl = process.env.PUBLIC_URL ?? ''
    const nextConfig = {
      allowedDevOrigins: URL.canParse(publicUrl) ? [new URL(publicUrl).hostname] : [],
    }
    ```

    The symptom is `Blocked cross-origin request to Next.js dev resource /_next/hmr` in the log.
    Angular and webpack-dev-server have an `allowedHosts` option for the same purpose.
10. **Secrets stay out of the file**; use the project's env tooling or cloud secrets.
11. **Verify.** Run `services_ensure`, fetch each portal URL (expect 200 and the app, not a
    blocked-host page), then scan each log after loading the page for host-block errors
    (`Blocked cross-origin request`, `Invalid Host header`, `Blocked request`), not only the status
    code. Then tell the user each service has a play button.

Flags that matter: Next `-p $PORT -H 0.0.0.0`, Vite `--port $PORT --host`, Storybook
`-p $PORT --host 0.0.0.0`.

Monorepo with postgres, api and web:

```yaml
services:
  postgres:
    command: docker compose up postgres
    port: 5432
  api:
    command: bun run dev
    cwd: apps/api
    health: /health
    portal: true
    setup:
      - bun run db:migrate
    env:
      DATABASE_URL: postgres://app:app@127.0.0.1:${services.postgres.port}/app
      WEB_ORIGIN: ${services.web.publicUrl}
  web:
    command: bun run dev
    cwd: apps/web
    health: /
    portal: true
    env:
      API_URL: ${services.api.publicUrl}
```

## One-off services

`service_start` with a `command` runs an undeclared process (a database, a scratch server) with the same env
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
- **Port collision** (`EADDRINUSE`): drop the fixed `port` so Atlas picks the name-derived one, or stop the
  process holding it (`service_list`, `service_stop`). Never kill by port from bash.
- **Blocked host / "Invalid Host header"**: see the framework notes; the host must be allowed.
- **Stale service**: the declaration changed after the service started. Call `services_ensure`; it restarts the service.
- **Setup failed**: read the command's output in the ensure reply, fix the command, ensure again.
- **Reference rejected**: check the target name exists, has a `portal` for `publicUrl`, and no cycle runs through the references.
