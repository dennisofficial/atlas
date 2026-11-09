# 0027. Each backend owns its work: the agent host calls the API for nothing, and both are NestJS

Accepted 2026-11-09. Amends the Pod → CP row of [architecture §5](../v2/architecture.md) and the
"API is called only for v1-owned config" exception it carried.

## Context

The v2 agent host is a backend in its own right: it holds a `@dltech/atlas-db` pool, Redis, the
control library, the sandbox provider, the token readers and the media signer, and it appends to the
control-plane record with Postgres writes. One edge did not follow that rule. The host reached the
API over tRPC (`apps/agent-host/src/control/client.ts`) for six procedures — `hostSelf.exposePort`
and `hostMemory.{list,get,write,edit,remove}` — behind a static shared secret
(`AGENT_HOST_TOKEN`), and the API answered them with business logic over the same database the host
already owned. Two processes, two auth mechanisms, one body of logic.

The same shaped problem sat on the other edge: the host's own HTTP surface (the stream WebSocket)
authenticated clients with a hand-rolled `SELECT … FROM "AuthSession"` while the API used
better-auth. Nothing shared a verification path.

## Decision

**D1. A backend does its own work.** If the host needs memory rows or a preview tunnel, it calls the
domain code in-process against its own connection. It makes no tRPC call to the API.

**D2. Domain logic that two backends need lives in a package, not in one app's router.**
`@dltech/atlas-memory` holds the stored-memory domain (list/get/put/edit/remove, revision guard,
project scoping) and `@dltech/atlas-previews` holds Cloudflare tunnels and preview routes. Each takes
its database handle and configuration as arguments and throws plain domain errors; `apps/api` keeps
thin Nest adapters that map those errors to the HTTP exceptions it returned before, and
`apps/agent-host` implements the `PodControlClient` port with them. Callers agree on the interface,
and the compiler enforces the dependency direction.

**D3. The two backends share one composition style.** `apps/agent-host` boots a
`@nestjs/core` application context with modules and providers, like `apps/api`. The stream server
keeps `Bun.serve` — Nest has no Bun WebSocket adapter and the live path is not moved for symmetry's
sake. The merge of the two apps is then a matter of lifting API modules into the same context.

**D4. One static secret leaves.** `AGENT_HOST_TOKEN`, its middleware, its routers and its env entry
are deleted. The host authenticates nobody's calls now, because it makes none.

## Reason

The edge existed only to reuse code, and it cost a second network hop, a second auth mechanism, a
second env var to rotate, and a class of failure (host healthy, API down, memory tools broken) that
should not exist between two processes on one database. The operator's rule: if the host needs to do
something, it can do it itself.

## Consequences

- `hostSelf.*` and `hostMemory.*` are gone from the generated `AppRouter`; nothing else called them.
- The host's tier files gain `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and
  `CLOUDFLARE_ZONE_ID` (`PREVIEW_DOMAIN` defaults to `byatlas.dev`, as in the API). The caveat is
  explicit: a Cloudflare zone-write token now lives in two places.
- Preview teardown still runs from the API's thread-archive cleanup (trigger.dev); it calls the same
  `@dltech/atlas-previews` code.
- The stream's session check and better-auth are still two implementations with the same source of
  truth. The port (`StreamAuthPort`) is the seam the merge binds to the API's `SESSION_VERIFIER`.
- The v1 exception is unaffected: sandboxes (`apps/serve`, `ATLAS_CLOUD_URL`) still call the API.
