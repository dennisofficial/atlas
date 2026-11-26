# @dltech/atlas-protocol

The wire schemas and the pure engines that the daemon, the agent host, the API and the clients
share. Every frame and every call is a `zod` schema here, and the daemon engine lives here too.

## Owns

- The daemon link frames: host frames, daemon frames, call keys, epochs and error kinds.
- The call operations the host sends to the daemon, and their results and events.
- The session API schemas: list, create, post, events, blob, withdraw, archive, status and drafts.
- The live frames, the pod call frames, the bus channel names, and the stream protocol constants.
- The daemon engine: the call journal, the ledger, fencing and the op groups.
- The terminal, files, context mirror, media, health, subscription, changes and diagram repair schemas.
- The Mac app link frames and JSON-RPC messages.

## Does not own

- The socket that carries a frame: `@dltech/atlas-host` connects, and `apps/daemon` serves.
- The logic of an op: `apps/daemon` runs a shell, a service or a git call.
- The HTTP routes: `apps/api` owns them.
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
- `callResultSchema`, `CallResult`, `okCallResultSchema`, `failedCallResultSchema`: the answer, whose
  status is an `ECallStatus`. `ECallFailure`: the failure code. `CallFailureError`: the thrown error.
- `daemonEventSchema`, `DaemonEvent`: an event that arrives during a call, such as shell output.

`exec` with `deadlineMs` and `shellId` turns into that background shell at the deadline.
The ops are `exec`, `exec.background`, `stat`, `readFile`, `readBytes`, `readTextForEdit`, `readLink`,
`readDirectory`, `writeFile`, `fetchToFile`, `digestFile`, `putFile`, `remove`, `mkdir`, `rename`,
`glob` and `grep`. They also include the groups `changes.*`, `git.*`, `mcp.*`, `metrics.*`, `oom.*`,
`previews.*`, `services.*`, `shells.*`, `terminal.*` and `watch.*`.

### Call a pod from the API

- `podCallRequestSchema`, `PodCallRequest`, `EPodCallKind`: the request that the API sends to the
  host that holds the session. The kinds are `invoke`, `follow`, `renew` and `release`.
- `podCallReplySchema`, `PodCallReply`, `EPodCallFailure`: the answer. A `failed` answer with
  `EPodCallFailure.Fenced` means the host that answered lost the session, so the caller routes the
  request again.
- `podStreamFrameSchema`, `PodStreamFrame`: an event, or a close with its reason, on a followed
  stream. `podReadySchema`, `PodReady`: the message that the host publishes when it holds the pod.
- `ELiveOpFailure`, `liveOpFailureSchema`, `CP_POD_OPS`, `EPodNotReady`: why the API cannot reach
  the op, the ops it calls on a pod, and the marker that tells a client to wait, not fail.

### Carry a frame over the link

- `hostFrameSchema`, `HostFrame`, `daemonFrameSchema`, `DaemonFrame`: the frame each side sends.
- `EDaemonErrorKind`, `ERunState`: the error kind and the run state a frame reports.
- `EDaemonCapability`, `capabilities` on the hello reply: what the daemon supports; an old one has none.
- `DAEMON_PORT`, `DAEMON_LINK_PROTOCOL_VERSION`, `DAEMON_LINK_PROTOCOL_MIN_VERSION`: the link
  constants. `DAEMON_LINK_SCHEMA_HASH`, `DAEMON_PROTOCOL_HEADER`, `DAEMON_MIN_PROTOCOL_HEADER`: the
  hash of `hostFrameSchema` and the two headers.

### Read and publish live state

- `liveFrameSchema`, `LiveFrame`: one streamed update of a held session.
- `sessionLiveChannel(sessionId)`, `panelHoldKey(sessionId)`, `PG_WAKE_CHANNEL`, `PG_CHANGE_CHANNEL`: the names.
- `frameStampSchema`, `compareFrameStamp({left, right})`: order two frames.

### Read a session's files

- `filesTreeInputSchema`, `filesSearchInputSchema`, `filesReadInputSchema`: browse, search and read.
  Each takes an optional `checkoutId` for that worktree instead of the launch directory; tree and read
  also take a `root`: `EFilesRoot.Context` reads the session's context folder instead of a checkout.

### Read a service's log

- `servicesLogInputSchema`, `servicesLogOutputSchema`: the session and service, and the last 64 KiB
  of that service's log as `text`, with `truncated` set when earlier output was dropped.

### Speak the session API

- `sessionListInputSchema`, `sessionSummarySchema`, `sessionListOutputSchema`: the session list.
- `sessionCreateInputSchema`, `sessionPostInputSchema`, `sessionEventsOutputSchema`: create, post, read.
- `sessionSubscriptionSchema`, `sessionSubscribeInputSchema`, `sessionUnsubscribeInputSchema`: a subscription has no expiry. `mediaPresignInputSchema`, `mediaConfirmInputSchema`, `mediaUrlInputSchema`: a composer upload, its confirmation, and the signed read of a stored picture.
- `ESandboxProvider`, `ECredentialSource`, `ESandboxStatus`: the sandbox provider, its source and status.
- `usageReportInputSchema`, `usageReportDtoSchema`, `usageWindowDtoSchema`: a plan account's usage
  as the API reports it, by account id or by provider, with the age of the reading.

### Carry a message payload

- `inboxMessageSchema`, `InboxMessage`: a message body: `text`, `clientId`, `via`, `media`,
  `uploads`, `attachments` and `files`.
- `inboxFileSchema`, `InboxFile`: a context file a spawn attaches for the child, `{path, text}`. A
  message carries at most 32. They belong to the child's context folder, not the model.

### Repair a diagram

- `diagramRepairInputSchema`, `diagramRepairOutputSchema`: repair a Mermaid diagram in place, and
  return its new source. `diagramRepairListInputSchema`, `diagramRepairListOutputSchema`: list the
  repairs that a session holds.

### Speak the stream protocol

- `parseServerMessage(raw)`, `parseClientMessage(raw)`: parse a frame, or refuse it.
- `STREAM_PROTOCOL_VERSION`, `STREAM_MAX_CLIENT_FRAME_BYTES`, `STREAM_TAIL_EVENTS`: the limits.
- `EStreamClose`, `EStreamErrorCode`, `EStreamSurface`: the close reason, error and surface. An `events` frame carries `cursor`: the stored `{seq, hash}` of its last event, which a client resumes from. The events themselves may be projected for egress, so a hash of the frame is not the stored one.

### Run the daemon side of the link

- `DaemonEngine`: the engine that holds a connection, replays the journal and runs the ops.
- `defineOp({op, run})`, `DaemonGroup`, `DaemonGroupFactory`, `CallContext`: one op in one group.
- `MemoryCallStore`, `CallJournal`, `ECallJournalState`: the journal a restart replays.
- `daemonToken({secret, sandboxName})`, `daemonTokenMatches({want, token})`: the token the host
  presents, derived from the sandbox name.

### Link to the Mac app

- `MAC_LINK_PATH`, `jsonRpcMessageSchema`, `macServerTransportSchema`: the relay and its transport.
- `macLinkPresenceKey(userId)`, `macLinkChannel(userId)`: the presence key and channel of a user.
- `macHostFrameSchema`, `macClientFrameSchema`, `macRelayFrameSchema`: the three frame directions.

## Usage

```ts
import { daemonFrameSchema, type DaemonFrame } from '@dltech/atlas-protocol'

export function frameOf(text: string): DaemonFrame {
  const parsed = daemonFrameSchema.safeParse(JSON.parse(text))
  if (!parsed.success) throw new Error('the daemon sent an invalid frame')
  return parsed.data
}
```

## Rules

- Parse every frame with its schema. Do not cast a wire value.
- Add an op to `ops/` and register it in `callOpSchema` and `okCallResultSchema`. Never add a loose
  `unknown` payload to a frame.
- Change a schema and bump the matching version constant (`DAEMON_LINK_PROTOCOL_VERSION`,
  `STREAM_PROTOCOL_VERSION`) in the same change. `hostFrameSchema` also raises both daemon link
  constants and `DAEMON_LINK_SCHEMA_HASH`; `bun scripts/check-daemon-link-skew.ts` enforces it.

## See also

- [docs/architecture.md](../../docs/architecture.md) for the daemon and the link.
- [docs/decisions/0017-wire-protocol-skew.md](../../docs/decisions/0017-wire-protocol-skew.md).
- `apps/daemon` for the op implementations, and `@dltech/atlas-host` for the other end.
