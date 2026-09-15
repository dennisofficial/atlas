# Vercel platform capabilities, September 2026

Research date: 2026-09-15. Primary sources only: vercel.com/docs, vercel.com/changelog, the
vercel/vercel monorepo (checked out at commit `c628be7`, an internal-sync snapshot dated
2026-09-08), the vercel/sandbox repo, and the published `@vercel/sandbox@3.3.0` npm tarball.
Anything I could not verify against one of those is marked **[unverified]**.

Context: Atlas Cloud runs a NestJS 11 backend on Vercel as a single function on Fluid compute
(iad1) and is about to run agent loops in Vercel Sandboxes with session state in Neon Postgres
and workspaces on Vercel Drives.

## 1. The Node.js launcher contract for zero-config backends (Express/NestJS/Fastify)

### The error we hit, and where it actually comes from

`Invalid export found in module "/var/task/apps/api/src/main.js". The default export must be a
function or server.` — this exact string is **not in the public vercel/vercel repo**. I grepped a
full checkout of `main` at `c628be7` for "must be a function or server", "Invalid export", and
"or server": zero hits outside tests and fixtures. The production Node.js launcher that emits it
is closed-source; the public repo only holds its functional mirrors (below). Any claim about that
launcher's internals beyond what the public mirrors show is **[unverified]**.

### What the public mirrors say the launcher accepts

`packages/node/src/bundling-handler.js` (the unified handler shipped with bundled lambdas, with a
comment that it "mirrors the detection logic in serverless-handler.mts") resolves a module in this
order:

1. **Web handlers**: named exports `GET`/`HEAD`/`OPTIONS`/`POST`/`PUT`/`DELETE`/`PATCH`, or a
   `fetch` export → wrapped into a Web-API Request/Response bridge.
2. **Function default export**: `(req, res) => void`. Nested `.default` chains are unwrapped up to
   5 levels (TS→CJS interop). Express apps work here because an Express app *is* a function.
3. **A captured server**: during `await import(entrypoint)`, `http.Server.prototype.listen` is
   monkey-patched so the first `.listen()` call is captured (arguments ignored — the port and the
   callback never execute), the patch is restored, and requests are proxied to a re-listened
   server on `127.0.0.1:0`. **If no server was captured by the time the import resolves, the
   launcher waits at most 1000 ms** (`maxTimeToWaitForServer = 1000` in
   `packages/node/src/serverless-functions/serverless-handler.mts`; the same 1000 ms timeout is in
   `bundling-handler.js`) before giving up and throwing.

Sources:
- https://github.com/vercel/vercel/blob/main/packages/node/src/bundling-handler.js
- https://github.com/vercel/vercel/blob/main/packages/node/src/serverless-functions/serverless-handler.mts

### Why conventional `bootstrap()` + `app.listen()` can fail

A NestJS entrypoint of the form

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

leaves the module with **no default export**, and the listen capture only fires once
`NestFactory.create()` finishes — after the module has finished importing. The import resolves as
soon as `bootstrap()` is *invoked* (the promise is not awaited at module scope), so the launcher
is then racing a fixed ~1 s capture window against Nest's entire DI container warmup. A real
NestJS app routinely takes longer than 1 s to `create()` on a cold lambda, the window expires, no
server is captured, no default export exists → the launcher falls through to the "default export
must be a function or server" failure. This is an inference from the public mirrors (the 1000 ms
constant is public; the production launcher's actual timeout is **[unverified]** because that code
is closed), but it is the only mechanism in the public code that produces this failure for exactly
the entrypoint shape we used.

**Docs vs. source disagree here.** The official NestJS docs page (last updated 2026-08-10) shows
precisely `bootstrap();` + `app.listen(process.env.PORT ?? 3000)` with no default export as the
canonical entrypoint, and the zero-config NestJS changelog (2025-10-17) shows
`NestFactory.create(AppModule).then(app => app.listen(3000))`. Neither mentions the capture
window or recommends a default export:
- https://vercel.com/docs/frameworks/backend/nestjs
- https://vercel.com/changelog/zero-configuration-support-for-nestjs

### The shape that the backends builder's own test fixtures use

The `@vercel/backends` package's own NestJS fixture (`packages/backends/test/fixtures/10-nestjs-no-build-command/src/main.ts`)
does something different from the docs:

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.init(); // init instead of listen (comment: avoids waiting for server kill in tests)
}
export default bootstrap();
```

i.e. the **default export is the bootstrap promise**. The docs contract for the wrapper builders
(Express docs, last verified on the live page) is "export the application as a default export of
the module or use a port listener":
- https://vercel.com/docs/frameworks/backend/express
- https://github.com/vercel/vercel/tree/main/packages/backends/test/fixtures

The skill reference file Vercel ships for coding agents
(`skills/vercel-cli/references/node-backends.md`) states: "We recommend using `export default` for
the app instance, but calling `.listen()` also works":
- https://github.com/vercel/vercel/blob/main/skills/vercel-cli/references/node-backends.md

### Entrypoint detection

Two distinct mechanisms exist:

- **Wrapper builders** (`@vercel/express`, `@vercel/hono`, `@vercel/fastify`, `@vercel/nestjs`,
  `@vercel/elysia`, `@vercel/h3`, `@vercel/koa`): `@vercel/nestjs` is generated by
  `generateNodeBuilderFunctions('nestjs', /@nestjs\/core/ import regex, ['src/main', 'src/app',
  'src/index', 'src/server', 'main', 'app', 'index', 'server'], ['js','cjs','mjs','ts','cts','mts'],
  nodeBuild)` — it delegates the whole build to `@vercel/node` after locating the entrypoint by
  scanning for a file that imports `@nestjs/core`. Sources:
  - https://github.com/vercel/vercel/blob/main/packages/nestjs/src/build.ts
  - https://github.com/vercel/vercel/blob/main/packages/build-utils/src/generate-node-builder-functions.ts
- **`@vercel/backends`** (v7.0.2 at research time): the consolidated rolldown-based builder used
  for **services** (`services` key in vercel.json — `packages/fs-detectors/src/services/resolve.ts`
  hard-routes web services to `@vercel/backends`). It runs the user's build command *first*, then
  finds the entrypoint (preferring `outputDirectory` when configured), bundles with rolldown using
  `preserveModulesRoot: repoRootPath` — which is why a monorepo handler lands at the repo-relative
  path `/var/task/apps/api/src/main.js` — and skips its own `tsc` typecheck when an explicit Build
  Command is configured. Sources:
  - https://github.com/vercel/vercel/blob/main/packages/backends/src/index.ts
  - https://github.com/vercel/vercel/blob/main/packages/backends/src/rolldown/index.ts
  - https://github.com/vercel/vercel/blob/main/packages/fs-detectors/src/services/resolve.ts

### Does `framework: "nestjs"` in vercel.json route to a different builder?

No. The framework preset `nestjs` in `packages/frameworks/src/frameworks.ts` declares
`useRuntime: { src: 'index.js', use: '@vercel/nestjs' }` with a `matchPackage: '@nestjs/core'`
detector — that is the same builder zero-config detection selects, so setting it explicitly and
letting detection run converge on the same path. `@vercel/backends` only enters via services mode
or the experimental flag (below). Source:
https://github.com/vercel/vercel/blob/main/packages/frameworks/src/frameworks.ts (nestjs preset at
~line 3570). One caveat: in services mode the `framework` key is *invalid at the top level* and
must move into the individual service object (https://vercel.com/docs/services).

### CLI / feature version timeline (verified from changelogs and docs notes)

- 2025-08-01 — zero-config Hono (https://vercel.com/changelog/deploy-hono-backends-with-zero-configuration)
- 2025-09-05 — zero-config Express (https://vercel.com/changelog/zero-configuration-express-backends);
  Express docs state minimum CLI **47.0.5** (https://vercel.com/docs/frameworks/backend/express)
- 2025-10-17 — zero-config NestJS (changelog above); NestJS docs state minimum CLI **48.4.0**
- 2026-01-15 — experimental rolldown build mode for Hono/Express, opt-in via
  `VERCEL_EXPERIMENTAL_BACKENDS=1`; adds TS path-alias support, extensionless relative imports, and
  better ESM/CJS interop (https://vercel.com/changelog/experimental-build-mode-hono-express).
  Whether that mode has since become the default for non-services projects: **[unverified]** — the
  changelog still labels it experimental and I found no "now default" post.

## 2. Fluid compute, current state

Source: https://vercel.com/docs/fluid-compute (page last updated 2026-08-24) and
https://vercel.com/docs/functions/usage-and-pricing (2026-06-16).

- **Default**: on for all new projects since 2025-04-23
  (https://vercel.com/changelog/fluid-compute-is-now-the-default-for-new-projects). Can also be set
  per-deployment/per-environment with `"fluid": true` in vercel.json
  (https://vercel.com/changelog/deployment-level-configuration-for-fluid-compute).
- **Concurrency**: multiple invocations share one function instance (Node.js and Python runtimes);
  Vercel "prioritizes existing idle resources before allocating new ones". **No fixed per-instance
  concurrency number is published [unverified]** — it is platform-managed, not configurable.
- **Pricing**: Active CPU (billed only while code runs, I/O waits pause CPU billing) + Provisioned
  Memory (billed GB-hour while any request is in flight) + Invocations ($0.60 per million on Pro,
  charged against the $20/mo Pro credit). Rates vary by region; the June 2025 Active CPU pricing
  change is https://vercel.com/changelog/lower-pricing-with-active-cpu-pricing-for-fluid-compute.
- **Duration limits**: default 300 s on all plans; max 800 s GA on Pro/Enterprise; **extended
  1800 s (30 min) in beta** for supported Node.js/Bun/Python runtimes, settable only per-function
  via `maxDuration`, and not available with Secure Compute during the beta
  (https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes, noted in the Fluid
  docs table).
- **Cold starts**: bytecode caching for Node.js 20+ (production only, first request uncached),
  pre-warming on production deployments, cross-AZ and cross-region failover.
- **Bundle size**: 250 MB standard; Large Functions (public beta) up to 5 GB on Fluid
  (https://vercel.com/docs/functions/limitations#large-functions-beta, referenced from the NestJS
  docs).
- Instance sizes: Standard = 1 vCPU / 2 GB, Performance = 2 vCPU / 4 GB
  (https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute).

## 3. Vercel Sandbox, current state

Sources: https://vercel.com/docs/sandbox (2026-09-03), https://vercel.com/docs/sandbox/sdk-reference,
https://vercel.com/docs/sandbox/pricing (2026-09-02), https://vercel.com/docs/sandbox/concepts,
the SDK repo https://github.com/vercel/sandbox, and the published `@vercel/sandbox@3.3.0` tarball
(npm `modified: 2026-09-11`). Sandbox is GA
(https://vercel.com/blog/vercel-sandbox-is-now-generally-available).

- **SDKs**: `@vercel/sandbox` (JS/TS), `vercel.sandbox` in the `vercel` Python package, and a
  `sandbox` CLI. Core classes: `Sandbox`, `SandboxUser`, `Session`, `FileSystem`, `Command`,
  `NetworkPolicy`, `Snapshot`, `Drive`.
- **Lifecycle**: `Sandbox.create({ name?, image?, source?, ports?, timeout?, region?, mounts?, env?,
  persistent?, ... })` → `sandbox.runCommand()`, `sandbox.stop()`, `sandbox.snapshot()`,
  `sandbox.extendTimeout()`, `Sandbox.get({ name })` to resume a named sandbox, `Sandbox.fork()`
  (since 2026-07-28, https://vercel.com/changelog/vercel-sandbox-supports-forking).
  **Persistence is the default**: on stop, the filesystem is snapshotted and restored on next
  resume; `persistent: false` opts out. Snapshots default to a 30-day TTL.
- **Max duration**: 24 h **per session** on Pro and Enterprise (up from 5 h on 2026-06-16,
  https://vercel.com/changelog/vercel-sandbox-can-now-run-for-up-to-24-hours); 45 min on Hobby.
  The cap applies to a session, not the sandbox — it resets on every stop/resume, so a persistent
  sandbox's total lifetime is effectively unbounded (pricing page, "Runtime limits").
- **Exposed ports**: pass `ports: number[]` (up to 15) at create; `sandbox.domain(port)` returns
  `https://<subdomain>.vercel.run` (verified in the published SDK: `Session.domain()` looks up the
  port in `this.routes` and returns `https://${route.subdomain}.vercel.run`, throwing if the port
  has no route). **These URLs are publicly accessible** — the concepts page warns "Exposed ports
  are accessible via a public URL, so be mindful of what services you run." **No per-port auth or
  token minting exists in the SDK or docs [unverified for Enterprise-only features]**; the security
  model is the unguessable subdomain, and any real auth must live in the app you run on the port.
  All traffic to and from exposed ports is billable egress.
- **What runs inside**: Firecracker microVMs with a dedicated kernel and full root — Docker,
  FUSE, VPN clients are explicitly supported. Default image `vercel/sandbox/universal` (Ubuntu,
  current Node LTS, Python 3.14, coding agents, common utilities). Custom OCI images from Vercel
  Container Registry are supported (since 2026-06-30,
  https://vercel.com/changelog/vercel-sandbox-now-support-custom-images), so **running our own
  compiled binary is just "put it in the image" or write it with `sandbox.writeFiles()`**. 64 GB
  ephemeral NVMe per sandbox (since 2026-09-11,
  https://vercel.com/changelog/vercel-sandbox-64-gb-storage); up to 32 vCPU / 64 GB RAM on
  Enterprise (8/16 on Pro).
- **Regions**: 19 regions; per-sandbox `region` param, defaulting to the project's default sandbox
  region or `iad1`. `failoverRegions` (Pro/Enterprise) is **incompatible with drive mounts** — see
  Drives below.
- **Pricing (iad1)**: Active CPU $0.128/h; Provisioned Memory $0.0212/GB-h; creations $0.60/1M;
  egress $0.15/GB (inbound/downloads free since 2026-07-17,
  https://vercel.com/changelog/data-downloaded-by-vercel-sandbox-is-now-free); snapshot storage
  $0.08/GB-mo. Concurrency: 10,000 sandboxes and a 5,000 vCPU/min dynamic allocation rate on
  Pro/Enterprise (raised 2026-08-05,
  https://vercel.com/changelog/vercel-sandbox-now-supports-10-000-concurrent-sandboxes-and-5-000-vcpus-per-minute).

## 4. Vercel Drives (private beta)

Sources: https://vercel.com/changelog/drives-for-vercel-sandbox-in-private-beta (published
2026-06-05) and https://vercel.com/docs/sandbox/concepts/drives (2026-09-04).

- **What it is**: persistent block-like storage with a lifecycle independent of any sandbox,
  mounted as a directory at sandbox creation. Files survive the sandbox stopping.
- **Access**: private beta behind a waitlist (typeform link in the changelog); requires the beta
  SDK/CLI tags (`@vercel/sandbox@beta`, `sandbox@beta`) per the changelog — though the GA-era docs
  already document the `Drive` class and mounts API, so the beta gate is the waitlist, not the
  SDK. Changelog: "Sandbox drives should not be used for production data while in private beta."
- **Mount model**: `Sandbox.create({ mounts: { '/abs/path': drive } })` for read-write, or
  `drive.snapshot()` for a point-in-time read-only mount. Up to 4 drives per sandbox; mount paths
  must be absolute and non-overlapping. **One read-write mount per drive at a time**; concurrent
  readers must use drive snapshots.
- **Region pinning / co-location**: a drive is created in one region (default `iad1`, settable via
  `region` at creation, **immutable afterwards** — requesting it with a different region or size is
  a `conflict` error). A sandbox mounting a drive **must run in the drive's region** and **cannot
  have `failoverRegions`**. So drive-backed sandboxes are pinned; plan the region up front.
- **Size/pricing**: default 1 TiB (1 GiB Hobby), 16 TiB quota ceiling (higher by support request).
  iad1: storage $0.05/GB-month (logical used size, metered hourly), reads $0.0015/GB, writes
  $0.004/GB. Performance: "NVMe speed writes and cache-hit reads, slower cache-miss reads."

## 5. Adjacent primitives (one paragraph each, agent-platform relevance)

- **Vercel Queues (public beta, https://vercel.com/docs/queues, 2026-09-03)**: durable append-only
  topics with fan-out consumer groups, at-least-once delivery, retries, visibility timeouts,
  idempotency keys, up to 7-day message TTL, push consumers via `experimentalTriggers:
  [{ type: 'queue/v2beta', topic }]` on a function, and a poll mode for external workers. For us:
  this is the natural transport for TUI↔session event fan-out and the "replay agent activity"
  pattern is explicitly listed as a use case — it could replace a hand-rolled event bus, but it
  does not own session *state*; Neon still owns that.
- **Vercel Workflows (https://vercel.com/docs/workflows, 2026-09-04)**: durable execution
  (`'use workflow'` / `'use step'`) on top of Queues + Functions + managed persistence; runs pause
  for minutes-to-months, survive deploys, support sleep/hooks/streams, and pin per-run to one
  region (`start(wf, args, { region })`, needs `workflow@5.0.0-beta.33+`). The Fluid docs position
  it as the answer for workloads beyond the 800 s/1800 s function ceiling. It replaces orchestration
  plumbing we'd otherwise write, not the agent loop itself.
- **eve (https://eve.dev/docs)**: Vercel's own agent framework/product — filesystem-authored agents
  (`agent/` directory: instructions, tools, skills, connections, subagents, schedules), each agent
  running in a Vercel Sandbox with `/workspace` seeding, channels for Slack/Discord/etc., and
  Connect-backed credentials the model never sees. It is a direct, Vercel-owned precedent for the
  architecture we're building (and partially overlaps it); worth studying, not obviously worth
  adopting wholesale.
- **Vercel Connect (GA 2026-08-25, https://vercel.com/changelog/vercel-connect-ga and
  https://vercel.com/docs/connect)**: team-level connectors to Slack/GitHub/Microsoft/Linear/
  Snowflake/Salesforce or any OAuth/API-key service; code calls `getToken()` (auth via the
  deployment's OIDC token) and receives short-lived provider tokens, so no provider secrets in env
  vars. Billed per token request ($3/1,000 on Pro). Directly relevant if sandboxes need to act on
  third-party services as a user.
- **Vercel Container Registry (https://vercel.com/docs/container-registry; introduced 2026-06-30,
  https://vercel.com/changelog/introducing-vcr-vercel-container-registry)**: OCI registry at
  `vcr.vercel.com/<team>/<project>/<repo>`, `vercel vcr build/push/login` CLI (12-h OIDC
  credentials), private by default with cross-team sharing and public repos. This is where custom
  sandbox images live — it replaces GHCR for our sandbox image if we want first-party integration,
  though nothing forces the move.
- **Services (https://vercel.com/docs/services, 2026-08-10; multi-framework launch 2026-06-30)**:
  multiple independently built backends/frontends in one project via the `services` key in
  vercel.json, sharing a domain, env, and top-level routing; internal service-to-service calls via
  bindings (beta since 2026-07-01,
  https://vercel.com/changelog/secure-internal-communication-between-services). This is the services
  mode that routes builds to `@vercel/backends` (see §1). Replaces the "one Vercel project per
  monorepo directory" split if we ever consolidate frontend + API.
- **Vercel Passport (GA 2026-07-31, https://vercel.com/changelog/vercel-passport-generally-available
  and https://vercel.com/docs/passport)**: Enterprise-only deployment protection in front of your
  own OIDC IdP (Okta, Entra ID, …); visitors authenticate before reaching the deployment, and the
  app can read/verify the Passport JWT (`external_sub` claim) and forward it to other backends.
  Runs before routes, so Protection Bypass secrets still work through it. It gates human browser
  access; it is not a machine auth mechanism and doesn't replace our bearer auth.

## 6. Monorepo / backend deploy gotchas current in 2026

- **Root directory**: the monorepo model is still one Vercel project per directory; the Root
  Directory setting scopes a project to a subdirectory of the git repo
  (https://vercel.com/docs/monorepos). New monorepo projects skip deployments whose files didn't
  change by default (lockfile-aware;
  https://vercel.com/changelog/new-monorepo-projects-now-skip-builds-with-unchanged-code-by-default
  and https://vercel.com/changelog/lockfile-aware-deployment-skipping-for-monorepos), toggleable in
  Root Directory settings. CLI monorepo flow wants CLI ≥ 20.1.0 and `vercel link` run from the repo
  root.
- **tsconfig path aliases**: in the `@vercel/backends` builder, rolldown is invoked with
  `tsconfig: true` (`packages/backends/src/rolldown/index.ts`), so `paths` are resolved at bundle
  time, not rewritten; the 2026-01-15 experimental-mode changelog lists "TypeScript path aliases
  are supported" as a headline fix, implying the older `@vercel/node` wrapper path does **not**
  handle them as reliably. There is a dedicated fixture `07-hono-ts-paths-import` in
  `@vercel/backends`'s test fixtures. Whether the wrapper-builder path rewrites or traces aliases
  today: **[unverified]** beyond that changelog implication.
- **Build command interaction**: `@vercel/backends` runs the user Build Command *before*
  entrypoint detection, so `nest build` output in `dist/` can be the entrypoint (comment in
  `packages/backends/src/index.ts`: entrypoint resolution happens after install+build "so
  entrypoints generated by the build are found"; `outputDirectory` config prefers entrypoints
  inside it). Configuring an explicit Build Command also **skips the builder's own `tsc`
  typecheck** ("Typecheck skipped (Build Command is configured)"). In services mode, `buildCommand`
  and `framework` are invalid at the top level of vercel.json and must move into each service
  (https://vercel.com/docs/services).
- **Deployment protection defaults**: docs describe no plan-level forced default; teams set a
  *team-wide default* (protection level All Deployments / Standard Protection / None × method
  Vercel Authentication / Passport / Password Protection) that new projects inherit
  (https://vercel.com/docs/deployment-protection, changelog
  https://vercel.com/changelog/set-team-wide-defaults-for-deployment-protection). **[unverified]**
  whether our specific Enterprise team has such a default configured — check team settings.
- **`all_except_custom_domains`**: this is the REST API enum value for **Standard Protection** —
  "protects all deployments **except** production domains". It appears as a `deploymentType` value
  for `passwordProtection`, `ssoProtection`, and `passport` in the Update Project endpoint
  (https://vercel.com/docs/rest-api/projects/update-an-existing-project; UI explanation at
  https://vercel.com/docs/deployment-protection#standard-protection). Note the migration gotcha the
  docs call out: under Standard Protection the production *generated* URL becomes restricted, so
  code using `VERCEL_URL`/`VERCEL_BRANCH_URL` must switch to the request's own host.
- **Protection Bypass for Automation**: mint/manage secrets via
  `PATCH /v1/projects/{idOrName}/protection-bypass` with a bearer token; body supports
  `generate` (optionally with your own 32-char alphanumeric secret and a note), `revoke` (with
  optional `regenerate`), and `update` (`isEnvVar` to bind one secret to the
  `VERCEL_AUTOMATION_BYPASS_SECRET` system env var). Multiple secrets per project are supported.
  Clients send `x-vercel-protection-bypass: <secret>` as a header (recommended) or query param.
  Sources: https://vercel.com/docs/rest-api/projects/update-protection-bypass-for-automation.md
  and https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation.
  The bypass does **not** override active DDoS mitigations or attack-mode rate limits. Rotating a
  secret requires a redeploy for the env-var value to update.

## Open risks for the agent-runtime plan

1. The NestJS listen-capture race (§1) is the thing most likely to bite again on cold starts;
   prefer `export default` of the app/bootstrap over bare `bootstrap();` despite what the docs
   example shows, since the docs and the observable runtime behavior disagree.
2. Exposed sandbox ports are unauthenticated public URLs (§3) — the TUI reaching a sandbox directly
   needs our own bearer check on whatever listens on the port; Vercel does not mint per-port tokens
   as far as public sources show.
3. Drives pin sandboxes to one region and disable failover (§4) — fine for iad1-only, but it makes
   region choice a permanent decision per workspace.
4. 24 h is a *session* cap; with persistence on by default, "24 h sessions on Enterprise" should be
   designed as a resume loop (`extendsTimeout` + stop/resume with snapshot restore), not a single
   uninterrupted VM lifetime.

## Primary sources

- Vercel docs: [Fluid compute](https://vercel.com/docs/fluid-compute),
  [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing),
  [NestJS on Vercel](https://vercel.com/docs/frameworks/backend/nestjs),
  [Express on Vercel](https://vercel.com/docs/frameworks/backend/express),
  [Sandbox](https://vercel.com/docs/sandbox), [Sandbox JS SDK reference](https://vercel.com/docs/sandbox/sdk-reference),
  [Sandbox pricing & quotas](https://vercel.com/docs/sandbox/pricing),
  [Sandbox concepts](https://vercel.com/docs/sandbox/concepts),
  [Drives](https://vercel.com/docs/sandbox/concepts/drives),
  [Queues](https://vercel.com/docs/queues), [Workflows](https://vercel.com/docs/workflows),
  [Connect](https://vercel.com/docs/connect), [Container Registry](https://vercel.com/docs/container-registry),
  [Services](https://vercel.com/docs/services), [Passport](https://vercel.com/docs/passport),
  [Deployment Protection](https://vercel.com/docs/deployment-protection),
  [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation),
  [Monorepos](https://vercel.com/docs/monorepos)
- Vercel REST API: [Update an existing project](https://vercel.com/docs/rest-api/projects/update-an-existing-project),
  [Update Protection Bypass for Automation](https://vercel.com/docs/rest-api/projects/update-protection-bypass-for-automation.md)
- Vercel changelog: [zero-config NestJS (2025-10-17)](https://vercel.com/changelog/zero-configuration-support-for-nestjs),
  [zero-config Express (2025-09-05)](https://vercel.com/changelog/zero-configuration-express-backends),
  [zero-config Hono (2025-08-01)](https://vercel.com/changelog/deploy-hono-backends-with-zero-configuration),
  [experimental backends build mode (2026-01-15)](https://vercel.com/changelog/experimental-build-mode-hono-express),
  [Fluid default for new projects (2025-04-23)](https://vercel.com/changelog/fluid-compute-is-now-the-default-for-new-projects),
  [higher Fluid defaults (2025-06-25)](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute),
  [30-minute functions (2026-06-15)](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes),
  [Sandbox 24 h (2026-06-16)](https://vercel.com/changelog/vercel-sandbox-can-now-run-for-up-to-24-hours),
  [Sandbox forking (2026-07-28)](https://vercel.com/changelog/vercel-sandbox-supports-forking),
  [Sandbox 10k concurrency (2026-08-05)](https://vercel.com/changelog/vercel-sandbox-now-supports-10-000-concurrent-sandboxes-and-5-000-vcpus-per-minute),
  [Sandbox 64 GB storage (2026-09-11)](https://vercel.com/changelog/vercel-sandbox-64-gb-storage),
  [Sandbox custom images (2026-06-30)](https://vercel.com/changelog/vercel-sandbox-now-support-custom-images),
  [Sandbox inbound data free (2026-07-17)](https://vercel.com/changelog/data-downloaded-by-vercel-sandbox-is-now-free),
  [Drives private beta (2026-06-05)](https://vercel.com/changelog/drives-for-vercel-sandbox-in-private-beta),
  [Connect GA (2026-08-25)](https://vercel.com/changelog/vercel-connect-ga),
  [Passport GA (2026-07-31)](https://vercel.com/changelog/vercel-passport-generally-available),
  [VCR introduced (2026-06-30)](https://vercel.com/changelog/introducing-vcr-vercel-container-registry),
  [Services multi-framework (2026-06-30)](https://vercel.com/changelog/run-multiple-frameworks-in-one-project-with-vercel-services),
  [service bindings beta (2026-07-01)](https://vercel.com/changelog/secure-internal-communication-between-services),
  [team-wide deployment protection defaults](https://vercel.com/changelog/set-team-wide-defaults-for-deployment-protection)
- Source code: [vercel/vercel @ c628be7](https://github.com/vercel/vercel/tree/main) —
  [packages/node/src/bundling-handler.js](https://github.com/vercel/vercel/blob/main/packages/node/src/bundling-handler.js),
  [packages/node/src/serverless-functions/serverless-handler.mts](https://github.com/vercel/vercel/blob/main/packages/node/src/serverless-functions/serverless-handler.mts),
  [packages/nestjs/src/build.ts](https://github.com/vercel/vercel/blob/main/packages/nestjs/src/build.ts),
  [packages/build-utils/src/generate-node-builder-functions.ts](https://github.com/vercel/vercel/blob/main/packages/build-utils/src/generate-node-builder-functions.ts),
  [packages/backends/src/index.ts](https://github.com/vercel/vercel/blob/main/packages/backends/src/index.ts),
  [packages/backends/src/rolldown/index.ts](https://github.com/vercel/vercel/blob/main/packages/backends/src/rolldown/index.ts),
  [packages/frameworks/src/frameworks.ts](https://github.com/vercel/vercel/blob/main/packages/frameworks/src/frameworks.ts),
  [skills/vercel-cli/references/node-backends.md](https://github.com/vercel/vercel/blob/main/skills/vercel-cli/references/node-backends.md);
  [vercel/sandbox](https://github.com/vercel/sandbox) and the `@vercel/sandbox@3.3.0` npm tarball
  (`dist/session.js`, `Session.domain()`);
  [eve docs](https://eve.dev/docs)
