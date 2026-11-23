# @dltech/atlas-api-router

The typed tRPC client of the Atlas API, and the SSE transport for a session stream. Every client
reaches the API through this package. No client imports `apps/api`.

## Owns

- `AppRouter`: the type of the API router.
- `createApiClient`: the tRPC client, with an HTTP link and a subscription link.
- The failure helpers that read a tRPC error.
- `sessionStreamTransport`: the follow and list streams of a session.

## Does not own

- The procedures and their input and output schemas. `apps/api` defines them.
- The session state that a client builds from the stream. `@dltech/atlas-client` owns it.
- The stream frame schema. `@dltech/atlas-protocol` owns it.

## Entry points

| Import                     | Use it for                                                                     |
| -------------------------- | ------------------------------------------------------------------------------ |
| `@dltech/atlas-api-router` | The router type, the API client, the failure helpers and the stream transport. |

## Capabilities

### Call the API

- `createApiClient({ baseUrl, token?, clientVersion?, credentials?, fetchFn?, EventSource? })`:
  returns an `ApiClient`. It speaks to `<baseUrl>/v1/trpc` over HTTP, and it uses an SSE
  subscription link for a subscription procedure. `credentials` is `'omit'`, `'same-origin'` or
  `'include'`.
- `ApiClient`, `ApiClientOptions`: the client type and its options.
- `httpStatusOf(failure)`: the HTTP status of a failed call, or `undefined`.
- `detailsOf(failure)`: the error details of a failed call, or `undefined`.
- `controlPlaneError(failure)`: a plain `Error` for a failure from the control plane.

### Follow a session

- `sessionStreamTransport({ client, surface?, handleUnauthorized? })`: returns a
  `SessionStreamTransport`. `follow({ sessionId, threadId?, afterSeq?, afterHash? }, handlers)`
  resumes from a sequence and hash. `list(handlers)` follows the session list.
- `SessionStreamHandlers`: `handleFrame`, `handleFailure` and `handleEnd`.
- `SessionStreamSubscription`: `close()`.
- The transport parses every frame with `streamServerMessageSchema` before it calls the handler.

## Usage

From `apps/web/src/features/sessions/data/session-stream.ts`:

```ts
import { sessionStreamTransport } from '@dltech/atlas-api-router'
import { EStreamSurface } from '@dltech/atlas-protocol'
import { createStreamConnection, systemStreamScheduler } from '@dltech/atlas-client/stream'

const connection = createStreamConnection({
  transport: sessionStreamTransport({
    client: api,
    surface: EStreamSurface.Web,
    handleUnauthorized: signOut,
  }),
  scheduler: systemStreamScheduler,
  eventSchema: sessionEventSchema,
  knownEventTypes: sessionEventTypes,
  views: sessionViews,
})
connection.connect()
```

## Rules

- Do not import `apps/api`. Import `AppRouter` from this package.
- Keep this package browser-safe. A spec scans the sources and fails on a Node-only import.
- Let `createApiClient` send the body. It base64-wraps a JSON body, because the Render edge WAF
  blocks a body by its content.
- The framework generates `src/generated/server.ts` with `nestjs-trpc`. Do not edit the file.

## See also

- `apps/api` owns the router that the generated type describes.
- `packages/api-router/src/__tests__/browser-safe.spec.ts` names the import rules.
