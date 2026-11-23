# @dltech/atlas-wire

The contract that crosses a seam. It holds the websocket channel frames, the HTTP request and
response payloads, the constants that both sides must agree on, and the sandbox provisioning
helpers. The serve process in a pod, `apps/api` and every client read it.

## Owns

- The channel frames: `serveFrameSchema`, `clientFrameSchema`, `encodeFrame`, `decodeServeFrame` and
  `decodeClientFrame`.
- The protocol handshake: `CHANNEL_SUBPROTOCOL`, `CHANNEL_PROTOCOL_VERSION`,
  `CHANNEL_PROTOCOL_MIN_VERSION`, `protocolSkewOf` and `negotiatedProtocolOf`.
- Capability negotiation: `ECapability`, `capabilitySetOf`, `supports` and the downgrade helpers in
  `agent-compat`.
- The HTTP request and response schemas that the API and its clients share.
- The sandbox provisioning helpers: the Vercel SDK wrapper, the serve install, launch and upload
  helpers, and the retry policies.
- The pod paths and environment names in `serve-env`.

## Does not own

- Event ids and event body shapes. `@dltech/atlas-core` owns them, and its branders make the ids.
- The thread record and its writes. `@dltech/atlas-control` owns them.
- Client state and the transcript. `@dltech/atlas-client` owns them.

## Entry points

| Import                   | Use it for                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `@dltech/atlas-wire`     | The full contract: frames, payload schemas, capabilities, pod paths, sandbox helpers. |
| `@dltech/atlas-wire/web` | The browser-safe subset: project, thread, settings, model, GitHub and event schemas.  |

## Capabilities

### Speak the channel

- `serveFrameSchema`, `clientFrameSchema`, `ServeFrame`, `ClientFrame`: the frame unions.
- `EServeFrame`, `EClientFrame`, `EClientRequest`: the frame and request kinds.
- `encodeFrame(frame)`, `decodeServeFrame(raw)`, `decodeClientFrame(raw)`: the JSON helpers. A
  decode returns `null` for an unknown frame.
- `CHANNEL_PROTOCOL_VERSION` (33), `CHANNEL_PROTOCOL_MIN_VERSION` (29): the newest and oldest
  protocol this build speaks.
- `protocolSkewOf(peer)`, `negotiatedProtocolOf(peer)`: the overlap of two protocol ranges.
- `bearerSubprotocolOf(token)`, `tokenFromSubprotocols(list)`: the token in the subprotocol.

### Negotiate a capability

- `ECapability`: the named capabilities, for example `attachments` and `model-availability-controls`.
- `capabilitySetOf(advertised)`, `supports({ capabilities, capability })`, `SERVE_CAPABILITIES`.
- `downgradeServeFrame({ frame, capabilities })`, `downgradeRoster`, `downgradeAgentOutcome`,
  `downgradeTurnOutcome`: the older-peer forms of a frame.

### Share an HTTP payload

- `threadMessageRequestSchema`, `threadMessageReplySchema`: the send of a message to a thread.
- `modelsResponseSchema`: the model list of the providers, with the live error.
- `classifierTestOutputSchema`: the outcome of a classifier connection test, a pass with its model
  and duration or a fault with its detail.
- `usageReportInputSchema`, `usageReportDtoSchema`, `usageWindowDtoSchema`: a plan account's usage
  as the API reports it, by account id or by provider, with the age of the reading.
- `memorySummarySchema`, `memoryEntrySchema`, `memoryListSchema`: the memory rows of a list and a
  read.
- `memoryPutSchema`, `memoryEditSchema`, `memoryKeySchema`: the memory write and edit payloads.
- `MEMORY_STALE_REVISION_CODE`, `MEMORY_EDIT_NO_MATCH_CODE`, `MEMORY_EDIT_AMBIGUOUS_CODE`: the
  memory error codes.

### Provision a sandbox

- `liveSdk`: the Vercel sandbox operations. `stateOf(status)`, `sandboxSessionIdOf(sandbox)`,
  `routedUrlOf(sandbox)`, `assertLiveSession`.
- `SANDBOX_REGION`, `SANDBOX_SERVE_PORT`, `WORKSPACE_PATH`, `SANDBOX_TIMEOUT_MS`.
- `createServeLauncher()`, `probeServeAlive(sandbox)`, `parseServeObservation(stdout)`.
- `installServe`, `serveInstallScript`, `uploadDevServe`, `isDevServeVersion(version)`.
- `settleRetry`, `imageOptimizeRetry`, `retrySleep(policy)`: the retry policies.
- `EBootStep`, `BOOT_STEP_ORDER`, `BOOT_STEP_EVENT_TYPE`: the boot progress the pod reports.

## Usage

From `apps/serve/src/frame-egress.ts`:

```ts
import { encodeFrame } from '@dltech/atlas-wire'
import { downgradeServeFrame } from '@dltech/atlas-wire'

const message = encodeFrame(downgradeServeFrame({ frame, capabilities }))
```

From `apps/mobile/src/sessions/load-sessions.ts`:

```ts
import type { WireThread } from '@dltech/atlas-wire/web'

export type LoadedSessions = { threads: readonly WireThread[] }
```

## Rules

- Add a capability for an additive change. Do not bump `CHANNEL_PROTOCOL_VERSION`. Bump it only for
  a changed frame shape.
- Keep the previous protocol in `CHANNEL_PROTOCOL_MIN_VERSION` until no sandbox runs it.
  `scripts/check-wire-skew.ts` fails a change that drops the protocol the base spoke.
- Import `@dltech/atlas-wire/web` in a browser bundle. Do not import the root subpath there. It
  loads `@vercel/sandbox` and `zod` schemas for the server.
- `apps/api` runs on Node with `module: NodeNext`, where a `.ts` specifier does not resolve. The
  package builds with its own `tsconfig.build.json` to `dist/`. Run
  `bun run build --filter @dltech/atlas-wire` before the API typecheck or test in a fresh checkout.

## See also

- `docs/decisions/0017-wire-protocol-skew.md`: the capability and skew rules, with the incident that
  forced them.
- `packages/wire/src/capabilities.ts`: the capability list and its comments.
