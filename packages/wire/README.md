# @dltech/atlas-wire

The one place the websocket channel contract and the REST wire schemas live. Three consumers
read this package: the harness's serve, the TUI over the harness barrel, and `apps/api` (the
factory's orchestrator channel and the sandbox provisioning layer).

## What belongs here

- Zod schemas describing what crosses the websocket or HTTP, and the frame encode/decode
  helpers around them.
- Constants both sides of a seam must agree on (protocol version, subprotocol, header names,
  the env var names a sandbox boots with).

Nothing with behavior lives here: no loop, no I/O, no tsyringe. Event IDs and event body shapes
are owned by `@dltech/atlas-core` (its only dependency) — the ID schemas are the branders, so
they are never re-derived.

## Consumption

Bun (harness, TUI, `bun test`) resolves the `bun` condition and imports `src/*.ts` raw, the same
as core and harness today.

`apps/api` runs on Node with `module: NodeNext`, where a `.ts` specifier cannot resolve. The
package therefore compiles with its own `tsconfig.build.json` (NodeNext, `dist/`, declarations)
and the default export condition points at the build output. `apps/api/Dockerfile` builds this
package before `nest build api`; for a fresh local checkout run `bun run build --filter
@dltech/atlas-wire` before the API's typecheck or test.
