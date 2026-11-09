# Next.js routing inside a desktop shell (Electron / Electrobun)

Research date: 2026-11-09. Sources: Next.js 16.3.5 docs (static exports, self-hosting), the installed
`apps/web` build, Electron `protocol` API docs, `electron-serve` source, `nextron` v10 source and README,
Bun's Next.js guide, and `electrobun@2.0.5`'s native wrapper.

## Conclusion

Electron has no Next.js-aware routing, and it does not need any: a Next App Router app keeps its
client-side router in any Chromium/WKWebView **as long as the app is served from an http-like origin
that answers the router's RSC request**. `file://` breaks it; a privileged `app://` scheme
(`standard`, `secure`, `supportFetchAPI`) or a loopback HTTP server both work. Atlas already serves
from loopback HTTP, so it is not missing anything Electron offers — it is running the same shape the
Electron ecosystem uses.

What actually costs Atlas the `.txt` payloads, `_` placeholder routes and `text/plain` content-type
rule is `output: 'export'`, not the shell. Next documents that static export cannot do dynamic routes
without `generateStaticParams`, and forbids `dynamicParams`, request-reading route handlers, cookies,
rewrites, redirects, headers, proxy and server actions. Atlas's placeholder trick is a workaround for
exactly that list.

The only shape that gives **real** Next routing in the desktop app is running Next's own server inside
it, and that is now cheap to try because Bun (the runtime the Mac host already uses) officially runs
`next build` and `next start`.

## How each shape behaves

| Shape                                                     | Next client routing                                                                                                   | What it costs                                                                    | Evidence                                                                                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadFile` / `file://`                                    | Broken: no `fetch` on `file://`, absolute `/_next/*` paths don't resolve; navigations fall back to document loads     | —                                                                                | Electron `protocol` docs ("Registering a scheme as standard allows relative and absolute resources to be resolved correctly… otherwise the scheme will behave like the `file` protocol") |
| Privileged `app://` scheme                                | Works, if the scheme is registered with `standard`, `secure`, `supportFetchAPI` (and `stream` for streaming payloads) | Static export required; every dynamic route prebuilt; SPA fallback handler       | `electron-serve` registers exactly `{ standard, secure, allowServiceWorkers, supportFetchAPI, corsEnabled, stream, codeCache }` and falls back to `index.html` for extension-less paths  |
| Loopback HTTP server                                      | Works, identical to a browser                                                                                         | Same static-export constraints; Atlas's current design                           | `apps/mac/src/host/static.ts`, `apps/web/DESKTOP.md`                                                                                                                                     |
| Next server in-app (`next start`, `output: 'standalone'`) | Full router: real `params`, per-request RSC, prefetch, `redirect()`                                                   | A server process in the app: startup latency, memory, larger bundle, supervision | Next self-hosting docs; Bun's Next.js guide (`bun --bun next build` / `bun --bun next start`)                                                                                            |

`nextron` — the maintained Next + Electron boilerplate, Next v10–v16 — is the ecosystem's answer: its
production config is `output: 'export'`, `trailingSlash: true`, `distDir: '../app'`, the window loads
`app://./home` through `electron-serve`, and the README states the reason: "we need to export static
files so as Electron can handle them". So the popular Electron + Next setup has the same limitation
Atlas has, and by consequence the same reload-on-navigation failure mode when a payload is missing.

## What static export makes impossible (Next's own list)

From the static-exports guide, unsupported with `output: 'export'`: Dynamic Routes with
`dynamicParams: true`; Dynamic Routes without `generateStaticParams()`; Route Handlers that rely on
`Request`; `cookies()`; `rewrites`; `redirects`; `headers`; Proxy; ISR; default `next/image` loader;
Draft Mode; Server Actions; Intercepting Routes. Client navigation between exported routes is
supported and documented ("a static payload for client navigation between routes", "this behaves like
a traditional SPA").

## Options for Atlas

| Option                                              | Deletes                                                                                                                       | Keeps paying                                                                                                                                                              | Verdict                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **A. Keep the static export**                       | —                                                                                                                             | `_` placeholder routes, `.txt`/`text/plain` coupling, `route-id.ts`, `staticParamsForDesktop`, `ignoreBuildErrors`, and a router port if the Mac ever gets its own router | Safe fallback; needs the navigation-owner fix plus an end-to-end nav test |
| **B. Run Next's server in the app** (Bun, loopback) | all of the above; one router for web and Mac, so no `next/link` port at all; real `params`, real prefetch, `redirect()` works | Next does request-time work again (only for its own routes — the API stays in `apps/api`); app size, startup, memory, process supervision                                 | Recommended, pending a spike                                              |
| **C. Plain SPA bundle (Vite + client router)**      | Next entirely on the desktop side                                                                                             | Route table, router adapter, two router runtimes while web stays Next                                                                                                     | Held per operator                                                         |

Option B's risk to state plainly: with the export, request-time server behavior is _impossible by
construction_; with a server, it becomes possible again and has to be forbidden by convention (a spec
that fails on `cookies()`, `headers()`, non-`force-static` route handlers).

## Spike results (2026-11-09)

Run on the pod (Linux x64, Bun 1.4.4, Next 16.3.5), `apps/web` built without `ATLAS_WEB_TARGET`
and without `output: 'export'`. The stand-in for the Mac host proxied `/api` and `/v1` to stubs and
everything else to the Next server, which is the shape `apps/mac/src/host` would take.

| Measurement                                                    | Result                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Build, server config                                           | 44s (26s with `output: 'standalone'`)                                                                                     |
| `bun --bun next start`: `Ready in`                             | 92ms                                                                                                                      |
| Spawn → first HTTP 200                                         | 375–472ms                                                                                                                 |
| `standalone/server.js` under Bun: spawn → first 200            | 473ms (`Ready in 0ms`)                                                                                                    |
| RSS, settled                                                   | ~105MB (`next start`), 166MB (`standalone` server.js), +8MB Bun wrapper                                                   |
| Dynamic route `/threads/abc` (no `generateStaticParams` entry) | 200 `text/html`                                                                                                           |
| Same route with `RSC: 1`                                       | 200 `text/x-component` (real flight response)                                                                             |
| Static chunk from the HTML                                     | 200 `application/javascript`                                                                                              |
| WebKit click session → `/threads/th1`                          | stayed client-side, 0 document requests, 1 `text/x-component` RSC                                                         |
| WebKit click New Thread                                        | stayed client-side, 0 document requests                                                                                   |
| Shippable web payload                                          | 83MB `standalone` (61MB traced `node_modules`, 22MB app) + 19MB `static` ≈ **102MB**, against **22MB** for today's export |
| Runs without Node installed                                    | yes: `PATH=/usr/bin:/bin`, child argv[0] `node` but `/proc/<pid>/exe` is `.../bin/bun`                                    |

Verdict: **go**, on the functional criteria. The Next router works end to end inside the app's own
Bun runtime, dynamic ids need no placeholder, and navigation is client-side with a real flight
response. Costs are launch latency (+0.4–0.5s to first byte, offset by today's client boot), ~105–166MB
resident, and a ~80MB larger web payload (compressed/`.app` delta still to be measured on a release
build).

What implementing it deletes: `apps/web/src/lib/route-id.ts` and every `generateStaticParams` /
`staticParamsForDesktop` call, `apps/web/DESKTOP.md`, `apps/mac/src/host/fallback-routes.ts`,
`static.ts`, `content-types.ts`, `desktopConfig` and `ignoreBuildErrors` in `next.config.ts`, and the
`text/plain` and `_`-placeholder rules. Dynamic pages take `params` from the server instead of parsing
`usePathname`.

What it adds, and must be built deliberately:
1. The host supervises a Next server process: spawn on a free loopback port, wait for ready before
   loading the window (or show the existing shell skeleton), kill on quit, restart on crash, and a
   visible failure state if it cannot start.
2. A guard spec that keeps Next a router and not a backend: fail on `cookies()`, `headers()`,
   non-`force-static` route handlers, server actions, or an async page that awaits data.
3. The Playwright navigation spec (already written during this spike) in CI against the packaged
   shape, so a Next upgrade that changes the flight protocol is a red build rather than a reload.
4. A real-Mac measurement of launch to first paint, RSS, and the `.app` delta before shipping.

## Web side: PostHog-only proxying

If `/api` and `/v1` rewrites are dropped, the web talks to `api.byatlas.io` directly, which makes
cookie auth cross-origin and requires: cookie `Domain=.byatlas.io`, `SameSite=Lax`, `Secure`; CORS on
the API allowing `https://byatlas.io` with credentials; and preview deployments on a `byatlas.io`
subdomain (a `*.vercel.app` preview is cross-site, so its cookies are blocked). The PostHog proxy
stays a first-party rewrite (`/ingest`) because adblockers block `*.i.posthog.com`; note that
`apps/web` has no PostHog today — only `apps/mobile` does.

## Sources

- Next.js static exports: https://nextjs.org/docs/app/guides/static-exports
- Next.js self-hosting: https://nextjs.org/docs/app/guides/self-hosting
- Electron `protocol`: https://www.electronjs.org/docs/latest/api/protocol
- `electron-serve`: https://github.com/sindresorhus/electron-serve (`index.js`)
- `nextron`: https://github.com/saltyshiomix/nextron (README, `examples/_template/ts/main/main.ts`)
- Bun + Next.js: https://bun.com/guides/ecosystem/nextjs
