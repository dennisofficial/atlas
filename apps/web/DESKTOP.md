# Desktop static export

`bun run build:desktop` writes `out/` (`ATLAS_WEB_TARGET=desktop`, `output: 'export'`, no rewrites).
The host serves it on the same origin as the `/api` and `/v1` proxy. Machine-readable mapping: `desktop-routes.json`.

Dynamic routes are prebuilt once with the placeholder id `_`. Client components read the real id from
`usePathname()` (`src/lib/route-id.ts`), so any id works when the host falls back to the placeholder HTML.

Request resolution, in order (path without query):
1. `/api/*`, `/v1/*` → proxy.
2. `out/<path>` if it is a file; `out/<path>.html`; `out/<path>/index.html` (`/` → `out/index.html`).
3. Fallbacks (only when 2 misses):
   - `/threads/<id>` → `out/threads/_.html`
   - `/projects/<id>/settings` → `out/projects/_/settings.html`
   - `/projects/<id>/settings/<tab>` with tab in `mcp|overview|sandbox|secrets` → `out/projects/_/settings/<tab>.html`
4. Otherwise `out/404.html` with status 404.

Serve `out/_next/**` and `__next.*.txt` payloads as plain files (step 2). Fallback HTML must be served with
`content-type: text/html`. Client-side navigation fetches RSC `.txt` payloads for real ids that do not exist; the
router falls back to a hard navigation, which the fallback above handles.
