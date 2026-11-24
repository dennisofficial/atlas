# @dltech/atlas-client

The headless client library that web, the TUI and the mobile app share.

## Owns

- The stream connection: follow a session, follow the session list, and reconnect with a watchdog.
- The client session log: one snapshot plus the events after it, in memory or in IndexedDB.
- The session window, the overlay of live steps, and the derived session views.
- The pod channel: the delta channel over a websocket, its frame codecs and its request timeouts.
- The transcript model: the rows of a turn, the tool runs and the thinking folds.
- The crew readout and the sidebar partition: sub-agent state, background work, teammate nesting.
- The session rewind, the composer image upload and draft, the message input and the device login.
- The chat step types for the AI SDK.

## Does not own

- Frame and payload schemas, the channel protocol: `@dltech/atlas-wire`, `@dltech/atlas-protocol`.
- Records and the API transport: `@dltech/atlas-control`, `@dltech/atlas-api-router`.
- The visual components, their styles, and the held composer state that a surface draws.

## Entry points

| Import                                          | Use it for                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `@dltech/atlas-client/stream`                   | The stream connection, the session follower, the log, the window and the overlay.             |
| `@dltech/atlas-client/channel`                  | The pod delta channel, the frame codecs and the tool requests.                                |
| `@dltech/atlas-client/chat`                     | The chat transport, the step chunks and the step messages.                                    |
| `@dltech/atlas-client/crew`                     | The crew readout, the sub-agent state and the background work.                                |
| `@dltech/atlas-client/session`                  | The session create input, the rewind, the image upload, the message input and the draft sync. |
| `@dltech/atlas-client/account`                  | The Atlas Cloud device-code login.                                                            |
| `@dltech/atlas-client/transcript`               | The transcript rows, the tool runs and the turn rows.                                         |
| `@dltech/atlas-client/stream-fixture`           | A fake scheduler and transport, and the event factories, for a spec.                          |
| `@dltech/atlas-client/channel-fixture`          | A fake channel socket and a channel harness, for a spec.                                      |
| `@dltech/atlas-client/transcript-fixture`       | The event drafts and the step signals of a transcript, for a spec.                            |
| `@dltech/atlas-client/transcript-tool-fixture`  | The tool call and result drafts, for a spec.                                                  |
| `@dltech/atlas-client/transcript-tools-fixture` | A sample tool call and shell call, for a spec or a prototype.                                 |

## Capabilities

### Follow a session

- `createStreamConnection({ transport, scheduler, networkSignal?, eventSchema?, knownEventTypes?, views? })`:
  the `StreamConnection`. `follow({ sessionId, threadId?, log? })` follows one thread, the main one
  by default; `followSessions()` gives the live list.
- `createSessionFollower(args)`: a session's follower, its connection state and snapshot.
  `HYDRATE_TIMEOUT_MS` bounds the first load. `createSessionsFeed({ follow, write })` holds the list.
- `StreamTransport`, `StreamScheduler`, `systemStreamScheduler`, `browserNetworkSignal`: the ports
  that a surface supplies.
- `nestPeers(rows)` nests each teammate under its spawner. `peerBucketOf({ row })` and
  `EPeerBucket` give a row's bucket; `splitTeammates(rows)` gives its active and done teammates.
  `isRecentProject(args)`, `lastActivityAt(args)` and `RECENT_PROJECT_WINDOW_MS` keep new projects.

### Keep the log and the view

- `memorySessionLog()`, `browserSessionLog(eventSchema)`, `createIndexedDbSessionLog(args)`: the
  `SessionLog` implementations.
- `SessionWindow`, `applyPage`, `applyPageOutcome`, `RENDER_LIMIT`, `OLDER_PAGE`: the paged window
  of a long thread.
- `applyOverlayMessage`, `closeOverlay`, `closeOverlayForEvents`, `EMPTY_OVERLAY_STATE`: the live
  step overlay. `overlaySignalsOf` and `overlayRewrote` give its step signals, append or rewrite.
- `derivedViewOf`, `deriveViewOf`, `deriveStatusOf`, `frameFactsOf`: the view of a followed session.
  `sessionDisplayOf`, `isSessionUnreadOf`, `startFailureOf`: the status, unread mark, start failure.
  `blockingCommandOf`, `elapsedClockOf`: the running command that holds the next turn, its clock.

### Read the pod channel

- `createRemoteDeltaChannel(args)`: the delta channel to the serve in a pod. `webSocketFactory`,
  `sessionSocketUrlOf`, `ChannelSocket`: the socket adapter. `encodeFrame`, `decodeClientFrame`,
  `EServeFrame`, `EClientFrame`: the client side of the frame codec.
- `EClientRequest`, `ChannelSignal`, `StepSignal`, `TurnOutcome`, `InFlightSlots`: the request names, the signals, a turn's outcome and the in-flight slots.

### Build the transcript

- `deriveTranscript(args)`, `assembleTranscript(args)`, `durableEntries(args)`, `EEntryKind`: the
  transcript rows and the durable rows of a thread; `pluginEntries` adds a plugin's rows. `summariesAtTarget(events)`: the events with
  each compaction summary at its target.
- `turnsBySeq(args)`, `settledAtOf(entries)`, `turnEndedEntry(turn)`: the turn rows and the settled
  time. `turnStartedAtOf({ events, status? })`: the open turn's start, or a queued session's `since`. `TurnSpend`, `totalSpend`, `SpendTotals` and `NOTHING_SPENT`: what a turn spent.
- `ECallState`, `ECallKind`, `callKindOf(name)`, `ToolCall`, `ToolRun`, `attachmentsOf`,
  `qualityNoticeOf`, `qualityNoticeLine`, `EQualityNoticeTone`: the tool runs and a call's quality
  line. `agentsOf(args)`, `agentOf(args)`, `agentLabelOf(agent)`: a sub-agent's type, intent, state.
- `noticeEntriesOf(event)`: one event's notice rows. `thinkingVisibilityOf`, `foldThoughts`, `toolsAboveThoughts`: the folds.
- `revealedText({ key, text, gate })`, `runAttentionOf(args)`, `plural(many, one, rest?)`,
  `formatElapsed(ms)`: the revealed text and the helpers that a surface also uses.

### Feed the chat transport

- `createSignalChatTransport({ now })`: returns a `SignalChatTransport` for the AI SDK.
  `absorb(signal)` adds a step signal to a stream and `dropAll()` closes every stream;
  `stepsOfMessages(messages)` gives the in-flight steps of an `AtlasStepMessage` list.

### Read the crew

- `crewRowReading(row)`, `subagentReading(subagent)`, `subagentStateLabel(args)`,
  `subagentContextLabel(args)`: the state and the label of a sub-agent. `crewActivityOf(args)`,
  `shellBusyThreads(rosters)`, `backgroundWaitLabel(args)`, `journalActivityOf(events)`,
  `lastVisitOf` and `recordDeparture`: the activity and the visits.

### Rewind a session

- `seqByEventIdOf(events)`, `rewoundMessageOf(args)`, `rewindLanded(args)`, `rewindRefused(args)`,
  `rewindKillsOf(args)`, `mergedDraftOf(args)`: the picked message, its sequence, the draft ahead of
  the composer, and the work the rewind stops.
- `restorePlanOf(attachments)`, `requestRewind(args)`: the attachments back in their composer
  stores, and the queued command. `RewindApi`, `RewoundMessage`, `RestorePlan`, `RestoredMedia`,
  `RewindKillRow`: the types.

### Start a session and upload a composer image

- `sha256Hex(bytes)`, `supportedMediaTypeOf(mediaType)`, `storeImage(args)` (optional `hashOf`
  without `crypto.subtle`): hash, type, presign-put-confirm. `messageInputOf(args)`,
  `postInputOf(args)`: draft and post input. Ports: `MediaUploadApi`, `PutImage`, `UploadHandle`.
- `sessionCreateInputOf(args)`, `initialProjectIdOf(args)`: a new session's create input and project.
- `composerSendStateOf`, `contextPercentOf`, `createDraftSync(args)`: send, context, draft write.
- `queuedMessagesOf`, `queuedNoticesOf`, `stagedQueuedMessagesOf`, `optimisticPlacementOf(args)`: the queued rows.

### Sign in to Atlas Cloud

- `beginCloudLogin(args)`, `pollCloudLogin(args)`: the device-code ticket and the poll outcome.
  `CLOUD_CLIENT_ID`, `CloudLoginTicket`, `ECloudLoginPoll` and `CloudLoginOutcome` are the grant and
  its types. `DeviceLoginError` carries the HTTP `status`, `0` when the host is unreachable.

## Usage

From `apps/web/src/features/sessions/data/session-stream.ts`:

```ts
const connection = createStreamConnection({
  transport: sessionStreamTransport({ client: api, surface: EStreamSurface.Web }),
  scheduler: systemStreamScheduler,
  eventSchema: sessionEventSchema,
  knownEventTypes: sessionEventTypes,
  views: sessionViews,
})
connection.connect()
```

## Rules

- Import a `-fixture` subpath in a spec, or in a prototype. Do not import it in a product path.
- Supply the stream transport and the scheduler. The stream connection opens no socket of its own;
  `createRemoteDeltaChannel` opens the websocket to the pod, through the socket factory.
- Pass the events through the protocol schema of the surface, which the log and the connection take
  as an `eventSchema`. Keep the derivation pure: a transcript or a view is a function of its inputs.
- Send a message through the channel. `SignalChatTransport.transport.sendMessages` throws.

## See also

- `docs/decisions/0024-v2-realtime.md`: the stream, the resume by sequence and hash, the overlay.
- `docs/decisions/0020-v2-sub-agent-worktrees-and-peer-sessions.md` describes the crew.
