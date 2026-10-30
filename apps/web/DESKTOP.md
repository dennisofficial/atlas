# Desktop static export

`bun run build:desktop` writes `out/` (`ATLAS_WEB_TARGET=desktop`, `output: 'export'`, no rewrites).
The host serves it on the same origin as the `/api` and `/v1` proxy.

Dynamic routes must `generateStaticParams` the placeholder id `_` in the desktop target and read the real id
from the URL (`src/lib/route-id.ts`). The host derives its dynamic-route table from the `_` placeholders in
the export (`apps/mac/src/host/fallback-routes.ts`); there is no hand-written mapping to update.

Request resolution, in order (path without query):
1. `/api/*`, `/v1/*` → proxy.
2. `out/<path>` if it is a file; `out/<path>.html`; `out/<path>/index.html` (`/` → `out/index.html`).
3. Only when 2 misses: every `_` path segment of the export is a wildcard for one segment. The request path
   is matched against those placeholder files with the same three lookups, so `.html` pages, `.txt` RSC
   payloads (`/threads/abc.txt` → `threads/_.txt`) and segment payloads
   (`/threads/abc/__next._tree.txt` → `threads/_/__next._tree.txt`) all resolve.
4. Otherwise `out/404.html` with status 404.

`.txt` payloads are served as `text/plain`, which the Next client router requires to treat a response as
flight data; without them every client navigation to a real id degrades to a full reload.
