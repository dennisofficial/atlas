<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Desktop (Mac) build

- The Mac app serves `bun run build:desktop` (`output: 'export'`). Keep web static-export safe: no
  `cookies()`/`headers()`, server actions, rewrites, or route handlers doing work.
- New dynamic routes follow `DESKTOP.md`: prebuild the `_` placeholder and read ids from the URL. The Mac
  host derives its route table from the export, so no Mac change is needed.
- The `mac-app-rehearsal` CI job builds the export on every PR.
- UI changes reach the Mac only on a release (PR title `fix` or `feat`).
