# @dltech/atlas-client

The headless client library that every surface shares. It follows a session live, keeps a local
session log, derives the session state and the transcript, and reads the crew. The web, the TUI and
the mobile app use it.

## Owns

- The stream connection: follow a session, follow the session list, and reconnect with a watchdog.
- The client session log: one snapshot plus the events after it, in memory or in IndexedDB.
- The session window, the overlay of live steps, and the derived session views.
- The pod channel: the delta channel over a websocket, its frame codecs and its request timeouts.
- The transcript model: the rows of a turn, the tool runs and the thinking folds.
- The crew readout: the state and the labels of a sub-agent, and the background work.
- The chat step types for the AI SDK.

## Does not own

- The frame and payload schemas, and the channel protocol. `@dltech/atlas-wire` and
  `@dltech/atlas-protocol` own them.
- The transport to the API. `@dltech/atlas-api-router` owns it.
- The visual components and their styles. Each surface owns its own.
- The records. `@dltech/atlas-control` owns them.

## Entry points

| Import                                          | Use it for                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `@dltech/atlas-client/stream`                   | The stream connection, the session follower, the log, the window and the overlay. |
| `@dltech/atlas-client/channel`                  | The pod delta channel, the frame codecs and the tool requests.                    |
| `@dltech/atlas-client/chat`                     | The chat transport, the step signals and the step messages.                       |
| `@dltech/atlas-client/crew`                     | The crew readout, the sub-agent state and the background work.                    |
| `@dltech/atlas-client/transcript`               | The transcript rows, the tool runs and the turn rows.                             |
| `@dltech/atlas-client/stream-fixture`           | A fake scheduler and transport, and the event factories, for a spec.              |
| `@dltech/atlas-client/channel-fixture`          | A fake channel socket and a channel harness, for a spec.                          |
| `@dltech/atlas-client/transcript-fixture`       | The event drafts and the step signals of a transcript, for a spec.                |
| `@dltech/atlas-client/transcript-tool-fixture`  | The tool call and result drafts, for a spec.                                      |
| `@dltech/atlas-client/transcript-tools-fixture` | A sample tool call and shell call, for a spec or a prototype.                     |

## Capabilities

### Follow a session

- `createStreamConnection({ transport, scheduler, networkSignal?, eventSchema?, knownEventTypes?, views? })`:
  returns a `StreamConnection`. `follow({ sessionId, threadId?, log? })` follows one thread, the
  main thread by default. `followSessions()` gives the live session list.
- `createSessionFollower(args)`: the follower for one session, with its connection state and its
  snapshot. `HYDRATE_TIMEOUT_MS` bounds the first load.
- `createSessionsFeed({ follow, write })`: a retained subscription to the session list.
- `StreamTransport`, `StreamScheduler`, `systemStreamScheduler`, `browserNetworkSignal`: the ports
  that a surface supplies.

### Keep the log and the view

- `memorySessionLog()`, `browserSessionLog(eventSchema)`, `createIndexedDbSessionLog(args)`:
  the `SessionLog` implementations.
- `SessionWindow`, `applyPage`, `applyPageOutcome`, `RENDER_LIMIT`, `OLDER_PAGE`: the paged window
  of a long thread.
- `applyOverlayMessage`, `closeOverlay`, `closeOverlayForEvents`, `EMPTY_OVERLAY_STATE`: the live
  step overlay.
- `derivedViewOf`, `deriveViewOf`, `deriveStatusOf`, `frameFactsOf`: the view of a followed session.

### Read the pod channel

- `createRemoteDeltaChannel(args)`: the delta channel to the serve in a pod.
- `webSocketFactory`, `sessionSocketUrlOf`, `ChannelSocket`: the socket adapter.
- `encodeFrame`, `decodeClientFrame`, `EServeFrame`, `EClientFrame`: the client side of the frame
  codec.
- `turn-outcome`, `signal`, `session-tools`, `subscription-tools`, `rewind-tools`, `in-flight`: the
  request and reply helpers.

### Build the transcript

- `deriveTranscript(args)`, `assembleTranscript(args)`: the transcript rows of a thread.
- `durableEntries(args)`, `EEntryKind`: the durable rows of a transcript.
- `turnsBySeq(args)`, `settledAtOf(entries)`, `turnEndedEntry(turn)`: the turn rows and the settled
  time.
- `ECallState`, `ToolCall`, `ToolRun`, `attachmentsOf`: the tool runs of a turn.
- `agentsOf(args)`, `agentOf(args)`, `agentLabelOf(agent)`: a sub-agent's type, intent and state.
- `thinkingVisibilityOf(value)`, `foldThoughts(args)`, `toolsAboveThoughts(entries)`: the thinking
  folds.
- `revealedText({ key, text, gate })`: the text that a surface reveals at a set pace.
- `runAttentionOf(args)`, `plural(many, one, rest?)`, `formatElapsed(ms)`: the helpers that a
  surface also uses.

### Feed the chat transport

- `createSignalChatTransport({ now })`: returns a `SignalChatTransport` for the AI SDK.
- `absorb(signal)`: adds a step signal to a stream. `dropAll()` closes every stream.
- `stepsOfMessages(messages)`: the in-flight steps of an `AtlasStepMessage` list.

### Read the crew

- `crewRowReading(row)`, `subagentReading(subagent)`, `subagentStateLabel(args)`,
  `subagentContextLabel(args)`: the state and the label of a sub-agent.
- `crewActivityOf(args)`, `shellBusyThreads(rosters)`, `backgroundWaitLabel(args)`,
  `journalActivityOf(events)`, `lastVisitOf`, `recordDeparture`: the activity and the visits.

## Usage

From `apps/web/src/features/sessions/data/session-stream.ts`:

```ts
import { sessionStreamTransport } from '@dltech/atlas-api-router'
import { EStreamSurface } from '@dltech/atlas-protocol'
import {
  browserSessionLog,
  createStreamConnection,
  systemStreamScheduler,
} from '@dltech/atlas-client/stream'

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

From `apps/mobile/src/sessions/use-sessions.ts`:

```ts
import { createSessionsFeed } from '@dltech/atlas-client/stream'

const release = createSessionsFeed({
  follow: () => sessionStream(api).followSessions(),
  write: setLive,
}).retain()
```

## Rules

- Import a `-fixture` subpath in a spec, or in a prototype. Do not import it in a product path.
- Supply the stream transport and the scheduler. The stream connection opens no socket of its own.
  `createRemoteDeltaChannel` opens the websocket to the pod, through the socket factory.
- Pass the events through the protocol schema of the surface. The log and the connection take an
  `eventSchema`.
- Keep the derivation pure. A transcript or a view is a function of the events and the steps.
- Send a message through the channel. `transport.sendMessages` throws.

## See also

- `docs/decisions/0024-v2-realtime.md`: the stream, the resume by sequence and hash, the overlay.
- `docs/decisions/0020-v2-sub-agent-worktrees-and-peer-sessions.md` describes the crew.
