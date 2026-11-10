<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Desktop (Mac) build

- The Mac app runs this app's own Next server on loopback (`output: 'standalone'`), supervised by the
  desktop host. There is no static export and no `_` placeholder route: a dynamic id is a real param.
- Next here is a router only. No `cookies()`/`headers()`, no server actions, no async pages, no route
  handler that reads the request — `src/app/__tests__/no-server-behaviour.spec.ts` fails otherwise. The
  API stays in `apps/api`.
- Read a dynamic segment in a client component with `useRouteParam` (`src/lib/route-param.ts`), never by
  parsing `usePathname()`.
- The `mac-app-rehearsal` CI job builds the packaged app and checks the built server answers flight
  requests on every PR.
- Interface changes reach the Mac as a web payload within minutes of a merge
  (`.github/workflows/web-ota.yml`); a change under `apps/mac/src` still needs a release.
