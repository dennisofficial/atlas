# Slice spec: notify only when the agent needs you

Status: **approved by Dennis 2026-11-23**, with the answers in §10. It changes the v2 notifications
built from [notifications.md](notifications.md). One rule governs push and in-app notices. Anchors are `path:line` at `05856454f`. Check an anchor again
before you rely on it.

## 1. Product contract

Dennis, 2026-11-23 (paraphrased): "HOLY SPAM." With about 20 sessions he gets a push each time a
turn ends. Most of those turns did not need him. The agent only stopped to wait for CI, a
background command or a sub-agent. He also wants to see numbers on notifications. Today there are
none.

**Rule.** Atlas sends "finished" only when the agent is really done, or when you started the turn.
Atlas does not send "finished" while work is still open that will wake the agent again. When that
work wakes the agent and the agent then finishes, you get one notification. "Failed" and
"waiting for you" do not change.

**Journey.** At 14:02 the agent pushes a PR, subscribes to CI and ends its turn. Nothing arrives.
At 14:09 CI goes green. The agent wakes, merges and ends its turn with nothing open. One
notification arrives at 14:10. A teammate that its parent agent briefed finishes at 14:05. Nothing
arrives, because the parent gets its report. You ask the teammate a question yourself. It answers,
and one notification arrives.

**Success.** About 65% fewer pushes (§3). No push for a turn that the agent wakes from within
minutes. A PostHog dashboard shows every moment, why it was sent or not, and what happened on the
device.

**Non-goals.** A digest notification ("3 sessions finished"). v1 sessions.

## 2. What exists today

- `packages/core/src/notify/moment.ts:41` `notifyMomentOf({ending, status})` gives `TurnFinished`
  for every completed turn, `TurnFailed`, or `WaitingForYou`.
- `packages/host/src/holder/held-turns.ts:243` `notifyTurn` runs after each `turn-ended` append
  (`:224`) and on a parked turn (`:133`). It runs for the main thread only. Sub-agent turns
  (`crew/child-turns.ts`) never notify. It calls `NotifyDispatch`
  (`packages/host/src/holder/notify-dispatch.ts:3`) with `{sessionId, threadId, seq, moment}`.
- `apps/api/src/agent/host/notify.port.ts:7` dispatches the trigger task `notify-send` with key
  `notify:<sessionId>:<seq>` (`packages/jobs/src/notify.ts:38`). `JobDispatch` already takes
  `delay` (`apps/api/src/_core/ports/job-dispatcher.ts:16`, passed on at
  `apps/api/src/_lib/trigger/trigger-job-dispatcher.ts:25`).
- `apps/trigger/src/trigger/notify/notify-send.task.ts:25` reads the session row, presence,
  devices and settings, and calls `notifyPlanOf` (`packages/core/src/notify/plan.ts:37`). The plan
  returns `null` for every silent case, so the reason is lost. The task returns `{sent, gone}` only.
- Pending work is already folded in core: `stepBackground` (shells, sub-agents,
  `packages/core/src/record/views/background-facts.ts:17`), `subscriptionsOf`
  (`packages/core/src/subscriptions/subscription.ts:38`), parked calls (`stepParked`,
  `packages/core/src/record/views/status-facts.ts:137`). The generic start/end fold is
  `LifecycleKind` + `lifecycleOf` (`packages/core/src/lifecycle/lifecycle.ts:24`, `:45`). Kinds
  exist for shells (`packages/core/src/shells/lifecycle.ts:15`, not exported yet), agents
  (`packages/core/src/agents/roster.ts:15`) and services (`packages/core/src/services/pairing.ts:21`).
- The arrivals that wake a thread are `INBOX_EVENT_TYPES` (`packages/core/src/record/inbox-event.ts:9`).
- Analytics: `ProductAnalytics.capture({userId, event, properties})`
  (`packages/observability/src/analytics/product-analytics.ts`), bound in the API
  (`apps/api/src/agent/analytics/analytics.module.ts:9`). Event names are snake_case, past tense
  (`apps/api/src/agent/analytics/append-hook.ts`). The trigger app has no analytics binding and no
  `@dltech/atlas-observability` dependency. No notification event exists.
- Click handlers that could report "opened": the service worker `notificationclick`
  (`apps/web/src/lib/service-worker-source.ts:75`), iOS `subscribeToNotificationResponses`
  (`apps/mobile/src/push/notification-handler.ts:48`). The Mac has a receive handler only
  (`apps/mac/apns.js:61`).

## 3. Real numbers (production, read-only, 2026-11-23)

Method, more numbers and caveats: [notify-rate-2026-11-23](../research/notify-rate-2026-11-23.md).
Window: 24 h to 2026-11-23T17:40Z.

| Measure                                                                          | Value                         |
| -------------------------------------------------------------------------------- | ----------------------------- |
| Main-thread turns that ended completed or failed (each dispatches `notify-send`) | 1252                          |
| Completed turns with open work at the end (shell, sub-agent or subscription)     | 793 of 1172 (68%)             |
| Of those, woke again within 5 min                                                | 69%                           |
| Of those, the next inbox entry in 5 min was a message from Dennis                | 21%                           |
| Pushes from nested teammate sessions (42 sessions)                               | 680 (54%)                     |
| Pushes within 60 s of a push from another session                                | 1062 (85%)                    |
| Parked durable waits open at a turn end                                          | 0 (3 `tool-parked` in 8 days) |
| `notify-send` runs since 04:23Z with `sent > 0` (sample of 175)                  | 0                             |

The last row: Dennis turned `web.notifications.event.finished.push` off at 06:39Z, and his only
device is one Web Push subscription. So today he gets no "finished" push at all. This spec is what
lets him turn it on again.

Simulated on the same 24 h (rule of §4, holds of 10 min and 60 min):

| Rule                                                          | Pushes per day       | In a 60 s burst |
| ------------------------------------------------------------- | -------------------- | --------------- |
| Today                                                         | 1252                 | 1062            |
| Hold while work is open                                       | 522                  | 406             |
| + nested sessions notify "finished" only for an operator turn | 443                  | 326             |
| + only the first push in 60 s per user makes a sound          | 443 (226 with sound) | —               |

Wakes after a turn that ended with only a subscription open: 87% within 10 min, 93% within 15 min.
With a shell or sub-agent open: 87% within 10 min, 98% within 60 min.

## 4. Design

### 4.1 Pending work: one generic fold in core

New file `packages/core/src/notify/pending-work.ts`. Each kind of pending work is one
`LifecycleKind` row in a table. A new kind is one new row. No tool name appears anywhere. Shells
and agents reuse the existing kinds (export `shellLifecycleKind`). Subscriptions get a new kind in
`packages/core/src/subscriptions/`; a pause closes and a resume opens.

```ts
export enum EPendingWork { Shell = 'shell', Agent = 'agent', Subscription = 'subscription' }

export type PendingWorkSource = {
  kind: EPendingWork
  holdMs: number
  lifecycle: LifecycleKind<Event, Event>
}

export const PENDING_WORK_SOURCES: readonly PendingWorkSource[]

export type PendingWork = { kind: EPendingWork; key: string; since: string }

export const pendingWorkOf = (args: { events: readonly Event[] }): readonly PendingWork[]
```

| Kind         | Opens                                                    | Closes                                                 | Key                    | Hold   |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------ | ---------------------- | ------ |
| Shell        | `background-shell-started`                               | `background-shell-ended`                               | `shellKey` (boot + id) | 60 min |
| Agent        | `agent-spawned`, `agent-restarted`                       | `agent-ended`                                          | `agentId`              | 60 min |
| Subscription | `subscription-created`, `subscription-changed` to active | `subscription-ended`, `subscription-changed` to paused | `subscriptionId`       | 10 min |

Rules that a spec enforces:
- Every close type, or the occurrences of the kind, wakes the thread. The spec asserts that each
  close type is in `INBOX_EVENT_TYPES`. A kind that cannot wake the agent is not pending work.
- A paused subscription delivers nothing, so it is not pending.
- Services are not pending work. A dev server runs until stopped and would hold every push.
- A parked call is not pending work. It already gives `WaitingForYou`.
- Teammates are other sessions. Their state is not in this log, so they are not pending work (§10).

The hold is a cap, not a wait. Most work wakes the agent sooner. A long-lived PR subscription or a
watcher shell must not hold the push forever.

### 4.2 Who the turn answered

New pure function `operatorTurnOf({events})` in `packages/core/src/notify/operator-turn.ts`: true
when a `user-said` with `saidBy(event) === EMessageOrigin.Operator`
(`packages/core/src/events/body.ts:98`) is in the log after the previous `turn-ended`. A parent
brief (`ParentAgent`) and a teammate message (`PeerAgent`) are not the operator.

### 4.3 The decision

New file `packages/core/src/notify/decision.ts`. It changes only `TurnFinished`.

```ts
export enum ENotifyVerdict { Send = 'send', Hold = 'hold' }

export type NotifyDecision = {
  moment: ENotifyMoment
  verdict: ENotifyVerdict
  holdMs: number
  pending: readonly EPendingWork[]
  operatorTurn: boolean
}

export const notifyDecisionOf = (args: {
  moment: ENotifyMoment
  pending: readonly PendingWork[]
  operatorTurn: boolean
}): NotifyDecision
```

- `TurnFailed` and `WaitingForYou`: `Send`, hold 0.
- `TurnFinished` with no pending work: `Send`, hold 0.
- `TurnFinished` with pending work: `Hold`, `holdMs` = the largest hold of the open kinds.

The host does not skip anything. Every moment is dispatched, so every moment is counted (§5).

### 4.4 The plan: every silent case has a reason

`packages/core/src/notify/plan.ts:37` returns `null` for each silent case today. Change it to
return a reason:

```ts
export enum ENotifySkip {
  Disabled = 'disabled',
  Quiet = 'quiet-hours',
  Read = 'already-read',
  OnScreen = 'on-screen',
  NoDevices = 'no-devices',
  Superseded = 'superseded',
  NestedAgentTurn = 'nested-agent-turn',
  SessionGone = 'session-gone',
}

export type NotifyPlan =
  | { mode: ENotifyMode.Push | ENotifyMode.InApp; notification: AtlasNotification; sound: boolean }
  | { mode: ENotifyMode.Silent; reason: ENotifySkip }
```

New facts in `NotifyFacts`: `superseded: boolean`, `nested: boolean`, `operatorTurn: boolean`,
`recentPush: boolean`. Order of checks: superseded, nested agent turn (only for `TurnFinished`),
disabled, quiet, read, on screen, in Atlas, no devices. `sound` is `!recentPush`.

### 4.5 Host and dispatch

- The facts are recorded on the turn end, so every client reads the same answer.
  `turnEndedSchema` (`packages/core/src/record/turns.ts:29`) gains an optional
  `notify: { pending: EPendingWork[]; operatorTurn: boolean }`. Optional, so old rows parse.
  `endTurn` (`held-turns.ts:200`) computes it before the append from
  `record.eventCache().eventsAfter(0)` (as `statusOf` does at `:262`) with `pendingWorkOf` and
  `operatorTurnOf`.
- `held-turns.ts:243` `notifyTurn` builds `notifyDecisionOf` from the same facts and passes the
  decision to `notify`. The parked path (`:133`) has no turn end. It stays `WaitingForYou`, `Send`.
- `NotifyDispatchArgs` (`notify-dispatch.ts:3`) gains `decision: NotifyDecision`.
- `notify.port.ts:7` dispatches with `delay` = `holdMs` in seconds when `holdMs > 0`. The key
  stays `notify:<sessionId>:<seq>`.
- `notifySendPayloadSchema` (`packages/jobs/src/notify.ts:11`) gains optional `holdMs`, `pending`,
  `operatorTurn`, `endedAt`. Optional, so a run that an older API deploy queued still parses.

### 4.6 The task decides at run time

`runNotifySend` (`notify-send.task.ts:25`):
- `superseded`: the main thread has a `turn-started` with `seq > payload.seq`. One indexed read
  (`V2Event_threadId_type_seq_idx`). A woken agent will decide again at its next turn end, so the
  held push is dropped. This gives one notification after a wake.
- `nested`: from the session row (`V2Session.nested` and `spawnedBySessionId`, select them in
  `notify-send-graph.ts:82`). A nested session sends "finished" only for an operator turn.
- `recentPush`: Redis `SET notify:sound:<userId> 1 NX PX 60000`. The first push in 60 s makes a
  sound. Later ones show silently (Web Push `silent`, no Expo `sound`, no APNs `sound`).

The wait lives in trigger.dev, not in the host. A host drain, a SIGKILL or a pod restart does not
lose it or run it twice: the run is already queued under its idempotency key, and the task reads
the truth from the database when it runs.

### 4.7 In-app notices follow the same rule

The in-app fold (`packages/notifications/src/client/in-app.ts:48` `momentOfRow`) reads the session
row, so the row carries the facts:
- `sessionTurnEndingSchema` (`packages/protocol/src/api.ts:216`) gains the optional `notify`
  object and `at`. `postgres-digests.ts:63-70` reads both from the same last `turn-ended`
  (`canonical -> 'notify'`, `e."at"`); `memory-digests.ts` does the same.
- `InAppRow` (`in-app.ts:11`) gains `nested`, and its `lastTurn` gains `notify` and `at`.
- New pure `inAppDueOf({ row })` in `packages/core/src/notify/in-app.ts` (beside `inAppNoticeOf`)
  returns `{ show: false }`, `{ show: true }` or `{ dueAt }`. It uses `notifyDecisionOf` and the
  nested rule, so push and in-app cannot disagree.
- A held moment shows at `dueAt` only if the row still has the same `lastTurn.seq` and its status
  is not active (`Thinking`, `RunningTool`, `Queued`, `Resuming`, `WaitingToRetry`). A wake that
  ends a new turn changes `lastTurn`, and that turn decides. This is the in-app form of
  "superseded".
- The web hook (`apps/web/src/features/notifications/use-in-app-notices.ts:46`) and the iOS
  provider (`apps/mobile/src/notifications/in-app-notices-provider.tsx:59`) keep one local timer
  per held moment and run the fold again when it fires. The timer reads no server, so it is not
  polling.

### 4.8 Where a tap goes

Every tap opens the session's main thread for the notification's `sessionId`. The transcript
opens at its end, where the turn ended. `seq` decides read and clear, not scrolling. §11 records
each surface and the fixes.

## 5. Metrics

Server events go through `ProductAnalytics` with `distinctId = userId`. The trigger task builds
its own `PosthogProductAnalytics` and flushes before it returns.

| Event                    | Where                                                        | Properties                                                                                         |
| ------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `notification_moment`    | API, `notify.port.ts`                                        | `moment`, `verdict`, `hold_ms`, `pending_kinds`, `operator_turn`, `session_id`, `seq`              |
| `notification_skipped`   | trigger, `notify-send`                                       | `moment`, `reason` (`ENotifySkip`), `held`, `nested`, `session_id`, `seq`                          |
| `notification_in_app`    | trigger (decided), clients via `notifications.track` (shown) | `moment`, `session_id`, `seq`, `source`                                                            |
| `notification_sent`      | trigger, one per device                                      | `moment`, `device_kind`, `accepted`, `gone`, `sound`, `held_ms`, `latency_ms`, `session_id`, `seq` |
| `notification_delivered` | device, via `notifications.track`                            | `moment`, `device_kind`, `session_id`, `seq`, `after_send_ms`                                      |
| `notification_opened`    | device, via `notifications.track`                            | same                                                                                               |
| `notification_dismissed` | device, via `notifications.track`                            | same                                                                                               |
| `notification_cleared`   | API `markRead` (`sessions.service.ts:355`)                   | `session_id`, `moment_seq`, `read_after_ms`                                                        |

What a device can know, and what each surface reports today (slice 6):

| Device                                      | Delivered                                                | Opened                                 | Dismissed                                                       |
| ------------------------------------------- | -------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| Web Push (Home Screen app, desktop browser) | service worker `push` event, reported at once            | `notificationclick`, before navigation | `notificationclose` where the browser fires it                  |
| iOS app (Expo)                              | not knowable without a native extension; `accepted` only | response listener, including a launch  | category with `customDismissAction`, set from JS; working today |
| Mac (APNs)                                  | `received-apns-notification` while the app runs          | launch tap of the notification         | not knowable; no category is registered                         |
| Web app, in-app notice                      | not applicable                                           | not applicable                         | reports `in-app-shown` through `notifications.track`            |
| iOS app, in-app notice                      | not applicable                                           | not applicable                         | reports `in-app-shown` through `notifications.track`            |

A device reports through one mutation, `notifications.track`, with `{event, sessionId, seq, moment,
deviceKind, sentAt?}`. Web push reads `moment` and `sentAt` from the push payload; Expo and APNs
carry them in the push data. A report never blocks a notification or a tap and its failure is
swallowed. The Mac reports through the desktop host, which holds the sign-in token.

`notifications.track` is one new tRPC mutation in
`apps/api/src/api/platform/control/notifications.router.ts`, input
`{event, sessionId, seq, moment, deviceKind, sentAt}`. The push data gains `moment` and `sentAt`,
so a device can report without a lookup. The iOS dismiss category is JS-only, so the native
fingerprint does not change.

**Dashboard "Notifications"** (PostHog, project of `POSTHOG_KEY`):
1. **Pushes per day by moment** — trend, `notification_sent`, breakdown `moment`.
2. **What turn ends became** — trend, `notification_moment`, breakdown `verdict`.
3. **Why no push** — stacked bar, `notification_skipped`, breakdown `reason`.
4. **Open work at turn end** — trend, `notification_moment` where verdict is hold, breakdown
   `pending_kinds`.
5. **Held, then sent or dropped** — `notification_sent` and `notification_skipped`
   (`superseded`) where `held = true`.
6. **Delivery rate by device** — formula, delivered ÷ sent, breakdown `device_kind`.
7. **Open rate by device** — funnel `notification_sent` → `notification_opened` (1 h, same
   `session_id` and `seq`), breakdown `device_kind`.
8. **Opened, dismissed or read elsewhere** — `notification_opened`, `notification_dismissed`,
   `notification_cleared`.
9. **Time to open** — median `after_send_ms` of `notification_opened`.
10. **Loudest sessions** — table, `notification_sent` by `session_id`, top 20.
11. **Bursts** — HogQL: largest count of `notification_sent` per user in any 5 min window per day,
    and the share with `sound = false`.
12. **Dead tokens** — `notification_sent` where `gone = true`, per day.

## 6. Slices

Each slice is one PR that merges alone, in this order.
1. **Pure decision.** `pending-work.ts`, `operator-turn.ts`, `decision.ts`, the `plan.ts` reasons,
   the core re-exports. Callers of `notifyPlanOf` adapt to the union (the task only).
   Files: `packages/core/src/notify/**`, `apps/trigger/src/trigger/notify/notify-send.task.ts`.
2. **Hold and run-time checks.** `held-turns.ts`, `notify-dispatch.ts`, `notify.port.ts`,
   `packages/jobs/src/notify.ts`, `notify-send.task.ts`, `notify-send-graph.ts` (session row
   fields, superseded read, sound key), the three transports for `sound`, and the
   `describeHandoff` scenario (§7).
3. **Server metrics.** `@dltech/atlas-observability` in `apps/trigger/package.json`; the five
   server events; the `markRead` clear event.
   Files: `apps/trigger/src/trigger/notify/`, `apps/api/src/agent/host/notify.port.ts`,
   `apps/api/src/agent/host/holder.module.ts`, `apps/api/src/api/platform/control/sessions.service.ts`.
4. **In-app follows the rule.** The `notify` and `at` fields on the digest and the summary schema,
   `inAppDueOf`, the web hook and iOS provider timers, and their specs.
   Files: `packages/protocol/src/api.ts`, `packages/control/src/postgres/postgres-digests.ts`,
   `packages/control/src/testing/memory/memory-digests.ts`, `packages/core/src/notify/in-app.ts`,
   `packages/notifications/src/client/in-app.ts`, `apps/web/src/features/notifications/`,
   `apps/mobile/src/notifications/`.
5. **Taps go to the session.** The three fixes of §11, with specs.
6. **Device metrics.** `notifications.track`; push data gains `moment` and `sentAt`; service worker
   `push`, `notificationclick`, `notificationclose`; the iOS response listener and dismiss
   category; the Mac receive handler.
   Files: `packages/wire/src/notify-wire.ts`, `apps/api/src/api/platform/control/notifications.router.ts`,
   `packages/notifications/src/{model,transports/*}.ts`, `apps/web/src/lib/service-worker-source.ts`,
   `apps/mobile/src/push/`, `apps/mac/apns.js`.
7. **Dashboard, live check, docs.** The PostHog dashboard (§5), the live check (§7), the roadmap
   entry, and `notifications.md` §4.1 points here.

## 7. Tests and live check

- **Core decision table** (`packages/core/src/notify/__tests__/decision.spec.ts`), plain events:

| Log at turn end                       | Moment   | Verdict | Hold   |
| ------------------------------------- | -------- | ------- | ------ |
| nothing open                          | finished | send    | 0      |
| shell started, not ended              | finished | hold    | 60 min |
| shell started and ended               | finished | send    | 0      |
| shell ended with another boot id only | finished | hold    | 60 min |
| agent spawned, not ended              | finished | hold    | 60 min |
| agent restarted after it ended        | finished | hold    | 60 min |
| subscription created                  | finished | hold    | 10 min |
| subscription paused                   | finished | send    | 0      |
| subscription paused, then active      | finished | hold    | 10 min |
| subscription and shell open           | finished | hold    | 60 min |
| service started                       | finished | send    | 0      |
| shell open, turn failed               | failed   | send    | 0      |
| parked call                           | waiting  | send    | 0      |

Plus: every close type is in `INBOX_EVENT_TYPES`; `operatorTurnOf` for operator, parent-agent,
peer-agent and no message; a `fast-check` case that adding a closed lifecycle never changes the
verdict.
- **Plan** (`plan.spec.ts`): each `ENotifySkip` reason in its order; nested with and without an
  operator turn; nested and failed still pushes; `recentPush` gives `sound: false`.
- **Host** (`packages/host/src/holder/__tests__`): a turn that ends with a shell open passes a
  hold decision; an operator stop still dispatches nothing.
- **API** (`apps/api/src/agent/host/__tests__`): a hold dispatches with `delay` and the same key;
  `notification_moment` is captured once; an analytics throw leaves the dispatch.
- **Trigger** (fake graph): a later `turn-started` gives `superseded` and no delivery; a nested
  agent turn is skipped; a second push in 60 s has `sound: false`; one `notification_sent` per
  device.
- **`describeHandoff`** (`apps/api/src/agent/__tests__/faults/handoff-notify-hold.fault.spec.ts`):
  a turn ends with a background shell open, then the host drains, is SIGKILLed, or the pod
  restarts. Assert one dispatch with a delay for that turn's seq, no dispatch from the replay on
  the new host, and one dispatch without a delay for the turn that the shell's end wakes. The rig
  passes a recording `notify` to `new SessionHolder` (`apps/api/src/agent/testing/host-process.ts:218`).
- **Live check on production** (temporary `AuthSession`, Dennis's user):
  1. A session runs a 90 s background command and ends its turn → `notification_moment` hold
     `[shell]`; the shell ends, the agent wakes and ends → one `send`; the held run reports
     `notification_skipped` `superseded`.
  2. A session spawns a sub-agent → the same shape with `[agent]`.
  3. A session subscribes to a finished workflow run → hold `[subscription]`, then one send.
  4. A parent spawns a teammate with a brief → the teammate's finish is `nested-agent-turn`; a
     direct message to the teammate → one send.
  5. A plain question → `send` with no delay.
  6. Each event is on the dashboard. With Dennis's approval, he turns "finished" push on and sees
     one Web Push per case. Archive every probe session and delete the `AuthSession` row.

## 8. Rollout

No migration. The payload fields are optional. The API deploys on merge. Trigger deploys after the
API is live (`release.yml` `render-live`). Slice 2 changes behaviour only for "finished" pushes,
which Dennis has off today.

## 9. Out of scope

- A digest notification across sessions. The silent repeat (§4.6) is the simple form.
- A sweep for a moment the host failed to dispatch (unchanged from notifications.md §7).

## 10. Answers from Dennis (2026-11-23)

1. **Holds:** keep 60 min for a shell or sub-agent and 10 min for an active subscription.
2. **Teammates:** a parent does not hold while its teammates are alive. A nested teammate sends
   "finished" only for a turn the operator started.
3. **Bursts:** later pushes inside 60 s are silent. No digest.
4. **In-app:** the same rule governs in-app notices (§4.7).
5. **Taps:** check where a tap goes on each surface and fix any that misses the session (§11).

## 11. Where a tap goes, per surface (checked 2026-11-23)

| Surface                    | Today                                                                                          | Right session | Fix (slice 5)                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web in-app toast "Open"    | `/sessions/<id>` (`use-in-app-notices.ts:63`, `v2-rows.ts:12`)                                 | yes           | none                                                                                                                                                                                                                                                                                                                                                                         |
| iOS in-app banner          | `/sessions/[id]` (`in-app-notices-provider.tsx:94`)                                            | yes           | none                                                                                                                                                                                                                                                                                                                                                                         |
| iOS push, app running      | `/sessions/[id]` (`notification-handler.ts:48`, `_layout.tsx:49`)                              | yes           | none                                                                                                                                                                                                                                                                                                                                                                         |
| iOS push, cold launch      | relies on the listener only; no launch-response read                                           | not sure      | read `getLastNotificationResponseAsync()` once on mount in `_layout.tsx` (JS only, no native change)                                                                                                                                                                                                                                                                         |
| Web Push, a window is open | `postMessage('open-session')` (`service-worker-source.ts:37`); no window listens               | **no**        | `existing.navigate('/sessions/<id>')`, then `focus()`, with the `openWindow` fallback, as `openRoutine` does (`:41`)                                                                                                                                                                                                                                                         |
| Web Push, no window        | `openWindow('/?session=<id>')`; `/` redirects to `/threads` and drops it                       | **no**        | `openWindow('/sessions/<id>')`                                                                                                                                                                                                                                                                                                                                               |
| Mac push (APNs)            | no click handler; the app comes forward at its last URL (`apps/mac/apns.js:61`, `main.js:291`) | **no**        | handle the clicked notification's `userInfo` in the main process (launch info on `ready` for a cold launch, the click event for a running app) and load `/sessions/<id>` in the window; `macPushOf` (`mac-native.ts:19`) parses it. Check the Electron version's API first; if Electron gives a running app no click event, record that here and handle the cold launch only |

The slice proves each fix with a spec: the service worker source navigates to the session href;
the iOS launch response routes once; the Mac handler loads the session URL. The live check (§7)
taps one notification on each surface.
