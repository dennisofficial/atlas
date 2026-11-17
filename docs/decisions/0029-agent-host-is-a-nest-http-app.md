# 0029. The agent host is a Nest HTTP app (Express + ws)

Accepted 2026-11-17. Supersedes the "plain Bun, no Nest" clause of
[0021](0021-v2-loop-runs-on-the-agent-host.md); the move into `apps/api` this makes possible is
[0030](0030-api-and-agent-host-are-one-render-service.md).

## Context

0021 put the agent host on a bare `Bun.serve` router: a hand-written if-chain over paths, hand-rolled
bearer resolution, CORS and body parsing in three handler modules, and `StreamConnection` typed
against Bun's `ServerWebSocket`. The API next to it is a Nest app with guards, pipes and lifecycle
hooks. Two transports, two ways to authenticate a request, two shutdown stories.

The agent host is also meant to become a module of `apps/api` rather than a forever-separate service,
and a `Bun.serve` router cannot be mounted into a Nest context.

## Decision

**The agent host boots with `NestFactory.create<NestExpressApplication>` (platform-express) plus
`@nestjs/platform-ws`'s `WsAdapter`, the same stack as `apps/api`.**
- HTTP routes are controllers: `GET /healthz`, `GET /stream` (426 without an upgrade),
  `POST /operator-requests/answer`, `POST /mcp-oauth/begin`, `GET /mcp-oauth/callback`. Route paths,
  status codes and CORS headers are unchanged.
- Authentication is a `BearerAuthGuard` over the existing `StreamAuthPort`, putting the user id on
  the request; request bodies go through a `ZodBodyPipe` over the schemas the handlers already had.
  The handler modules keep their decisions and lose their CORS/bearer/path preamble.
- `/stream` is a `@WebSocketGateway` over `ws`. `StreamConnection` depends on a small socket port
  (`send`, `close`, `bufferedAmount`) instead of `ServerWebSocket`; origin refusal and the draining
  503 are answered by `verifyClient`, so a refused upgrade keeps its HTTP status. Drain keeps its
  going-away frame, random reconnect spread, user slots and instant wait-until-empty.
- Shutdown is Nest's: `beforeApplicationShutdown` drains the stream and the holder behind a hard
  deadline, `onApplicationShutdown` closes the rest, and `enableShutdownHooks({ useProcessExit })`
  ends the process with the code the start chain asserts.

## Consequences

`apps/agent-host` now shares Nest conventions with `apps/api`, so the stream and the operator routes
can move into the API as one module. The cost is Nest's boot path: the stream specs boot a real Nest
app on port 0 instead of calling a factory.
