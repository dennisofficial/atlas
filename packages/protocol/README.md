# @dltech/atlas-protocol

The wire schemas and the pure engines that the daemon, the agent host, the API and the clients
share. Every frame and every call is a `zod` schema here, and the daemon engine lives here too.

## Owns

- The daemon link frames: host frames, daemon frames, call keys, epochs and error kinds.
- The call operations the host sends to the daemon, and their results and events.
- The session API schemas: list, create, post, events, blob, withdraw, archive, status, and the
  inactive and archived bucket page (`sessionBucketPageInputSchema`, `sessionBucketPageOutputSchema`).
- The live frames, the bus channel names, and the stream protocol constants.
- The daemon engine: the call journal, the ledger, fencing and the op groups.
- The terminal, files, media, health, subscription and changes schemas.
- The Mac app link frames and JSON-RPC messages.

## Does not own

- The socket that carries a frame: `@dltech/atlas-host` connects, and `apps/daemon` serves.
- The logic of an op: `apps/daemon` runs a shell, a service or a git call.
- The HTTP routes: `apps/api` and `@dltech/atlas-control`.
- The session state machine: `@dltech/atlas-core`.

## Entry points

| Import                            | Use it for                                              |
| --------------------------------- | ------------------------------------------------------- |
| `@dltech/atlas-protocol`          | Frames, call ops, API schemas, live frames, stream.     |
| `@dltech/atlas-protocol/engine`   | The daemon engine: `DaemonEngine`, `defineOp`, journal. |
| `@dltech/atlas-protocol/mac-link` | JSON-RPC frames between Atlas and the Mac app.          |
| `@dltech/atlas-protocol/testing`  | An in-memory daemon, a frame queue and conformance.     |

## Capabilities

### Send a call to the daemon

- `callOpSchema`, `CallOp`, `OpName`: the discriminated union of every op.
- `callResultSchema`, `CallResult`, `okCallResultSchema`, `failedCallResultSchema`: the answer.
- `daemonEventSchema`, `DaemonEvent`: an event that arrives during a call, such as shell output.

The ops are `exec`, `stat`, `readFile`, `readBytes`, `readTextForEdit`, `readLink`, `readDirectory`,
`writeFile`, `fetchToFile`, `remove`, `mkdir`, `rename`, `glob` and `grep`. They also include the
groups `changes.*`, `git.*`, `mcp.*`, `metrics.*`, `previews.*`, `services.*`, `shells.*`,
`terminal.*` and `watch.*`.

### Carry a frame over the link

- `hostFrameSchema`, `HostFrame`: what the host sends.
- `daemonFrameSchema`, `DaemonFrame`: what the daemon sends.
- `EDaemonErrorKind`, `ERunState`: the error kind and the run state a frame reports.
- `DAEMON_PORT`, `DAEMON_LINK_PROTOCOL_VERSION`, `DAEMON_PROTOCOL_HEADER`: the link constants.

### Read and publish live state

- `liveFrameSchema`, `LiveFrame`: one streamed update of a held session.
- `sessionLiveChannel(sessionId)`, `PG_WAKE_CHANNEL`, `PG_CHANGE_CHANNEL`: the channel names.
- `frameStampSchema`, `compareFrameStamp({left, right})`: order two frames.

### Read a session's files

- `filesTreeInputSchema`, `filesSearchInputSchema`, `filesReadInputSchema`: browse, search and read.
  Each takes an optional `checkoutId`; when it is set, the directory or path resolves inside that
  checkout's worktree instead of the session's launch directory. `filesTreeInputSchema` and
  `filesReadInputSchema` also take an optional `root`: `EFilesRoot.Context` resolves the path inside
  the session's context folder instead of any checkout.

### Read a service's log

- `servicesLogInputSchema`, `servicesLogOutputSchema`: the session and service, and the last 64 KiB
  of that service's log as `text`, with `truncated` set when earlier output was dropped.

### Speak the session API

- `sessionListInputSchema`, `sessionSummarySchema`, `sessionListOutputSchema`: the session list.
- `sessionCreateInputSchema`, `sessionPostInputSchema`, `sessionEventsOutputSchema`: create, post, read.
- `sessionSubscriptionSchema`, `sessionSubscribeInputSchema`, `sessionUnsubscribeInputSchema`.

### Carry a message payload

- `inboxMessageSchema`, `InboxMessage`: a message body: `text`, `clientId`, `via`, `media`,
  `uploads`, `attachments` and `files`.
- `inboxFileSchema`, `InboxFile`: one context file a spawn attaches for the child, `{path, text}`.
  A message carries at most 32. These files belong to the child's context folder; they are not
  model attachments.

### Speak the stream protocol

- `parseServerMessage(raw)`, `parseClientMessage(raw)`: parse a frame, or refuse it.
- `STREAM_PROTOCOL_VERSION`, `STREAM_MAX_CLIENT_FRAME_BYTES`, `STREAM_TAIL_EVENTS`: the limits.
- `EStreamClose`, `EStreamErrorCode`, `EStreamSurface`: the close reason, error and surface.

### Run the daemon side of the link

- `DaemonEngine`: the engine that holds a connection, replays the journal and runs the ops.
- `defineOp({op, run})`, `DaemonGroup`, `DaemonGroupFactory`, `CallContext`: one op in one group.
- `MemoryCallStore`, `CallJournal`, `ECallJournalState`: the journal a restart replays.
- `daemonToken({secret, sandboxName})`, `daemonTokenMatches({want, token})`: the token the host
  presents, derived from the sandbox name.

### Link to the Mac app

- `MAC_LINK_PATH`, `jsonRpcMessageSchema`, `macServerTransportSchema`: the relay and its transport.
- `macLinkPresenceKey(userId)`, `macLinkChannel(userId)`: the presence key and the frame channel
  for one user.
- `macHostFrameSchema`, `macClientFrameSchema`, `macRelayFrameSchema`: the three frame directions.

## Usage

```ts
import { daemonFrameSchema, type DaemonFrame } from '@dltech/atlas-protocol'

const parsed = daemonFrameSchema.safeParse(JSON.parse(text))
if (!parsed.success) throw new Error('the daemon sent an invalid frame')
const frame: DaemonFrame = parsed.data
```

## Rules

- Parse every frame with its schema. Do not cast a wire value.
- Add an op to `ops/` and register it in `callOpSchema` and `okCallResultSchema`. Never add a loose
  `unknown` payload to a frame.
- Change a schema and bump the matching version constant (`DAEMON_LINK_PROTOCOL_VERSION`,
  `STREAM_PROTOCOL_VERSION`) in the same change.

## See also

- [docs/v2/architecture.md](../../docs/v2/architecture.md) for the daemon and the link.
- [docs/decisions/0017-wire-protocol-skew.md](../../docs/decisions/0017-wire-protocol-skew.md).
- `apps/daemon` for the op implementations, and `@dltech/atlas-host` for the other end.
