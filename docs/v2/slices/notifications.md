# Slice spec: notifications that follow your eyes

> **Approved by Dennis 2026-11-23.** Mac push ships with the release pipeline change (option A). The agent sets up Apple signing itself: the App ID push capability, the APNs key and the provisioning profile, through the App Store Connect API key stored in EAS (read with EXPO_TOKEN), with clear names.

Status: **draft 4, 2026-11-23**. The operator's words are in §1, and his answers of 2026-11-23
are binding (`decisions.md`). v2 has no notification of any kind today, so this is new design,
not a port. The v1 code is evidence of what went wrong, never a base. Anchors are `path:line` at
`ee5fdfde`; re-check one before you rely on it. Style follows `docs/v2/slices/operator-input.md`.

## 1. Product contract

The operator, 2026-11-22:

> Push notifications were kinda verbose. Even though I'm looking at the session, or I'm on the
> website or Mac, my phone would just spam me. It needs to be smart. We should have notifications
> on Mac, web and iOS. If I'm on iOS I should get in-app notifications, but if all mediums are
> closed, then it'll show a notification. And if I open my phone, the notification from all should
> clear of course, and natively clear as well.

**Mental model.** Atlas tells you once, where your eyes already are. If the session is on your
screen, nothing interrupts you. If you are in Atlas but in another session, Atlas marks it inside
the app and nothing leaves the machine. If no Atlas client is in front of you, your devices get an
OS notification. Opening the session anywhere takes the notification away everywhere.

**Journey.** A turn ends at 14:02. You are on your Mac reading another session → a toast in the
Mac window, no OS notification, the phone stays quiet. At 14:20 you are away: no Atlas window has
focus → one notification on the iPhone, one on the Home Screen web app and one on the Mac, quit or
not, one per session however many turns end. You open the session on the phone → it goes from the
phone's notification centre, from the web app's, and from the Mac's lists when the Mac next comes
forward or next launches; the unread dot is gone on every surface.

**Core objects.**
- **Moment** — one of three things: a turn finished, a turn failed, the session waits for you.
- **Presence** — a client's report about itself: which surface, which session is on screen,
  whether it is in front, and when. It expires by itself.
- **Decision** — one pure function over a moment, the read marker, presence and the device count.
  It answers: stay silent, mark inside the app, or push to devices.
- **Notification** — the model one decision produces: session, seq, moment, title, body, time.
- **Device** — one push target: a Web Push subscription (Home Screen web app or desktop browser),
  an Expo token (iOS app), or an APNs token (Mac app).
- **Read marker** — `V2Session.readSeq` (`packages/db/src/prisma/schema/v2/session.prisma:37`),
  which already drives the unread dot. Notifications share it, so "read" means one thing.

**Success.** No OS notification while an Atlas client is in front of you. One notification per
session per device, never a pile. Opening the session clears it everywhere, first inside the app,
then natively where the platform allows. The dot and the notification never disagree.

**Non-goals.** Email. Notification actions and reply. Per-device sound and badge choices. Mute
rules beyond the settings page. v1 sessions.

## 2. The Mac: APNs through Electron, and what it costs

**The answer (Dennis, 2026-11-23).** The Mac gets native notifications, including while the app is
closed if that is possible.

**The four options, and what each one gives.**

| Option                                      | A notification arrives when                                                       | Cost                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Electron `Notification` in the main process | the app runs: a window, no window, or a hidden window. Never when the app is quit | nothing beyond the signing the app already has                                                              |
| A login item or a background process        | the app runs because it starts at login and never quits                           | the app must always run: battery, a permanent Dock or menu-bar entry, and the operator's consent            |
| APNs through Electron's `pushNotifications` | the Mac is awake, whether the app runs or not                                     | an App ID with push, the `aps-environment` entitlement, a provisioning profile, a `.p8` key, an APNs sender |
| Web Push in Electron                        | never                                                                             | not supported                                                                                               |

**`Notification` needs no window.** It is a main-process module: the main process builds the object
and calls `show()`, so a hidden window and no window behave the same
(<https://www.electronjs.org/docs/latest/api/notification>). On macOS it is UNNotification beneath,
so the app must be code-signed and an unsigned build emits `failed`
(<https://www.electronjs.org/docs/latest/tutorial/notifications>). Atlas signs with Developer ID and
notarizes (`docs/decisions/0028-mac-shell-is-electron.md`), so this part costs nothing new. It cannot
outlive a quit: the process is gone.

**A login item only keeps that process alive.** `app.setLoginItemSettings({openAtLogin: true})` adds
the app as a login item, registered through `SMAppService` on macOS 13 and later (`type`
`mainAppService` is the default)
(<https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows>). It
works, but it buys delivery by removing the operator's ability to close Atlas, and it fails silently
when the app is not signed and notarized. Rejected.

**Web Push does not exist in Electron.** The request in the Electron tracker has been open since 2016
(<https://github.com/electron/electron/issues/6697>), and the notification tutorial describes only the
`Notification` class and the renderer's web `Notification`
(<https://www.electronjs.org/docs/latest/tutorial/notifications>). A service worker can run, but there
is no `PushManager`, so no subscription and no push service. Confirmed: not an option.

**APNs is in Electron itself.** Electron 45.2.3 (pinned at `apps/mac/package.json:27`) ships the
`pushNotifications` main-process module: `pushNotifications.registerForAPNSNotifications()` resolves
with the device token, and `received-apns-notification` carries `userInfo` while the app runs
(<https://www.electronjs.org/docs/latest/api/push-notifications>). An alert push is drawn by macOS
itself, so it arrives with the app quit. No Swift helper, no native module.

**Chosen: APNs through `pushNotifications`.** It is the only option that reaches a quit app, and it
adds no second executable. What it costs:
- The App ID `io.byatlas.mac` (`apps/mac/electron-builder.yml:1`) gets the Push Notifications
  capability in the developer account. macOS then needs the
  `com.apple.developer.aps-environment` entitlement, macOS 10.14 and later, in
  `apps/mac/build/entitlements.mac.plist`, and the build must be signed through a provisioning
  profile (`mac.provisioningProfile` in `electron-builder.yml`)
  (<https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns>,
  <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.aps-environment>).
- A second provider protocol in the trigger task: APNs over HTTP/2, token-based, with a `.p8` key, its
  key id and the team id. Four secrets in `apps/trigger/.env.production.enc`: `APNS_KEY_P8`,
  `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`.
- The operator allows notifications for Atlas once, on the first launch.

**Its limits, named.** macOS draws the banner, so Atlas cannot withdraw one that was delivered while
the app was quit; the group leaves at the next launch. An alert push has no silent form: the clear is
a second `content-available` push, which only a running app reads. Delivery to a sleeping Mac waits
for the wake, as it does for the phone (§4.9).

## 3. What exists today

**The stream is one-way. This decides the presence design.** Every client opens one tRPC
subscription per thing it follows (`packages/api-router/src/stream.ts:93-116`), and the client
sends nothing back on it. `streamClientMessageSchema` (`packages/protocol/src/stream-client.ts:36-47`)
declares `hello`, `subscribe`, `unsubscribe`, `resnap` and `ping`, but its server parser
`parseClientMessage` (`packages/protocol/src/stream.ts:51`) has no production caller. A "presence
frame on the socket" would need that duplex path built first. This spec does not build it (§4.2).

**v1, the evidence (deleted with v1; do not extend it).**
- v1 pushes only when a session's main thread ends a turn:
  `apps/api/src/api/platform/sandboxes/sandbox-self.router.ts:249-258`. Suppression is a Redis
  presence hash read with a 70 s staleness window, written by a 25 s heartbeat from the web bundle
  (`apps/api/src/api/platform/presence/presence-entries.ts:1-2`, `presence.service.ts:5,24-53`).
  The phone spams because that rule answers "was this browser on this thread", not "are you here".
- Devices and sends: `apps/api/src/api/platform/notifications/push-devices.router.ts:22-49`,
  `packages/db/src/prisma/schema/user-config/push-device.prisma:2-16` (one row per Expo token),
  `packages/wire/src/push-devices-wire.ts:3-35`, and the send task
  `apps/api/src/trigger/notifications/push-send.task.ts` → `push-send-graph.ts`.
- Clearing on read exists for iOS only: a silent `contentAvailable` push, dismissed in a background
  task (`apps/mobile/src/push/background-notifications.ts:7-22` →
  `notification-handler.ts:23-33`). It needs `enableBackgroundRemoteNotifications`
  (`apps/mobile/app.config.ts:29`).
- The mobile client already speaks the shape we need: `registerPushDevice`
  (`apps/mobile/src/push/register-push.ts:10-19`), the foreground suppressor keyed on `AppState`
  (`apps/mobile/src/push/notification-handler.ts:4-15`), and the dismiss-by-thread helper
  (`:23-33`).
- **Web and Mac have no OS notification at all.** `apps/web/src/app/manifest.ts:5-21` declares a
  Home Screen web app. There is no service worker and no `Notification` call in `apps/web` or
  `apps/mac`.

**v2 today.**
- The turn boundary is explicit: `turn-ended` with `outcome` and `by`
  (`packages/core/src/record/turns.ts:28-33`), appended by `HeldTurns.endTurn`
  (`packages/host/src/holder/held-turns.ts:131-158`), whose `append` returns the appended events
  (`:23-31`), so the seq of the boundary is known.
- A parked turn writes no `turn-ended` (`packages/host/src/holder/turn-boundary.ts:27-50` returns
  `null` for `Parked`), so "waiting for you" is a status (`ESessionStatus.WaitingForOperator`,
  `WaitingForCredentials` — `packages/core/src/record/views/status-types.ts:1-12`), not an event.
- The read marker is one column, written from web
  (`apps/web/src/features/sessions/data/use-session-mark-read.ts:22-43`) and from the phone
  (`apps/mobile/src/thread/v2/use-v2-session-screen.ts:116`), behind
  `packages/control/src/session-ops.ts:88` and `apps/api/src/api/platform/control/sessions.router.ts:160-164`.
  The wire carries read state per session (`packages/wire/src/session-wire.ts:49-57`), and the web
  query client refetches on window focus (`apps/web/src/lib/query-client.ts:21`). The unread dot is
  `lastAssistantSeq > readSeq` (`apps/web/src/features/shell/v2-status.ts:57-61`).
- The surfaces already name themselves: `EStreamSurface` = web, desktop, ios
  (`packages/protocol/src/stream-constants.ts:57-61`), and the host records the last one
  (`apps/api/src/agent/stream/session-surface.ts:5-16`, wired at
  `apps/api/src/agent/host/follow-stack.ts:44-47`).
- The host already owns Redis (`apps/api/src/agent/host/follow-stack.ts:39`) and already dispatches
  trigger jobs through one port (`apps/api/src/_core/ports/job-dispatcher.ts:11-32`) with a
  transport-neutral contract file (`apps/api/src/agent/host/pod-disk-grow-one.contract.ts:29-38`)
  and a port that builds it (`apps/api/src/agent/host/pod-disk-pressure.port.ts:11-33`). The v2
  trigger project is `apps/trigger/trigger.config.ts:4-11`, and the tier env is read from
  `apps/trigger/src/trigger/tier-env.ts:5-7`.
- The Settings → Notifications page exists and is live, but it shows a 6 × 3 matrix that nothing
  reads: `apps/web/src/features/settings/pages/notifications.tsx:80-152`, events in
  `apps/web/src/features/settings/fixtures/settings-interface.ts:18-46`, keys in
  `packages/core/src/settings/cloud/web-only-settings.ts:22-38,66-80`, rows served by
  `apps/api/src/api/cloud/settings/settings.router.ts:21-36`.

## 4. Design

### 4.1 Moments

Three only, and they come from facts the host already holds.

| Moment            | Source         | Rule                                             |
| ----------------- | -------------- | ------------------------------------------------ |
| `turn-finished`   | `turn-ended`   | `outcome = Completed`                            |
| `turn-failed`     | `turn-ended`   | `outcome = Failed`, or `Interrupted` by the host |
| `waiting-for-you` | session status | `WaitingForOperator` or `WaitingForCredentials`  |

An operator stop (`outcome = Stopped`, `by = Operator`) writes no moment: you did it yourself.
`packages/core/src/notify/moment.ts`:

```ts
export enum ENotifyMoment {
  TurnFinished = 'turn-finished',
  TurnFailed = 'turn-failed',
  WaitingForYou = 'waiting-for-you',
}

export const notifyMomentOf = (args: {
  ending: { outcome: ETurnOutcome; by: ETurnEndedBy } | null
  status: ESessionStatus
}): ENotifyMoment | null
```

A parked turn passes `ending: null` and the parked status, and gets `WaitingForYou` when the status
is one of the two waiting states. The settings key for each moment is the event id the page already
uses: `finished`, `errored`, `approval`
(`packages/core/src/settings/cloud/web-only-settings.ts:22-29`).

### 4.2 Presence: event-driven, reported by the client, expired by the server

No window, no "touched in the last five minutes". A client says when it comes forward and when it
leaves, and the record lives only as long as the client keeps saying so.

**Report.** A client reports three facts: surface, the session on screen (`null` when the list is
on screen), and `foreground`. It reports on every change, and repeats every 30 s while foreground.
`foreground` means "the operator is looking at this client":

| Surface                | Foreground when                                                   | Away on                                         |
| ---------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| web, Mac (same bundle) | `document.visibilityState === 'visible'` and the window has focus | `blur`, `visibilitychange` → hidden, `pagehide` |
| iOS (Expo)             | `AppState === 'active'`                                           | `AppState` → `inactive` or `background`         |

The web side listens to `focus`, `blur`, `visibilitychange` and `pagehide`; `pagehide` sends the
away report with `navigator.sendBeacon`, so a closing tab still delivers it. `beforeunload` is
listed with `pagehide` in the brief, but it does not fire reliably on iOS Safari; `pagehide` does.
The Mac app is Electron and runs the same bundle, so it needs no separate code.

**React Native `AppState` states, and the decision.** `active` means the app is in the foreground.
`background` means another app or the home screen. iOS adds `inactive`, which happens during the
transition between the two and while the system UI covers the app: the app switcher, Control
Centre, the Notification Centre, or an incoming call
(<https://reactnative.dev/docs/appstate>; Apple's life-cycle guide,
<https://developer.apple.com/documentation/uikit/app_and_scenes/managing_your_app_s_life_cycle>).
Android adds `blur` for the notification drawer, which does not change `AppState`.

**`inactive` counts as away.** Reason: in `inactive` the system UI covers the app, so the operator
cannot see a turn finish, and iOS can suspend the app at any moment from that state. Treating it as
"at Atlas" would silence the phone exactly while the operator puts the app down. The cost is a
transient: a moment that lands during the few hundred milliseconds of a transition can produce an
OS banner while the operator comes back. That is rare, and the banner is the same notice that
session would have shown anyway, so we accept it. `inactive` never marks a session read.

**The worked example, met.** You send a message from the iPhone app. You leave the app: `AppState`
goes `inactive` then `background`, the app reports away, the host deletes the record. No Atlas
window is focused, so no other record is fresh. The reply lands one minute later →
`turn-finished`, no fresh foreground presence, devices exist → Web Push and Expo both send. The
phone shows an OS notification.

**A disconnected client.** The v2 stream is one-way (§3), so a socket close cannot carry presence.
The guarantee is expiry instead: each record has a 90 s lifetime, refreshed by the 30 s repeat. A
client that dies without a word — a killed browser, a lost network, a crashed app — stops
refreshing, and its record is gone within 90 s. A short-lived client that leaves cleanly is gone at
once. A record is never used as a "recently seen" hint; only a live one counts.

**Transport and store.** A tRPC mutation, not a stream frame:
`notifications.reportPresence({clientId, surface, sessionId, foreground})` with an empty reply.
Schema in `packages/wire/src/notify-wire.ts`; route beside the other v2 routers
(`apps/api/src/api/platform/control/sessions.router.ts`). The store is one Redis hash per user,
`atlas:v2:presence:<userId>`, one field per client id holding
`{surface, sessionId, foreground, at}`, with a 90 s TTL refreshed on each write. Redis because the
reader is the trigger task, a different process from the host (`apps/api/src/agent/host/follow-stack.ts:39`).
A wrong answer costs one unnecessary or one missing push, never correctness.

The pure part is small and testable: `presenceIsFresh({at, now})` and `notifyPresenceOf(...)` in
`packages/core/src/notify/presence.ts`. The constants `PRESENCE_TTL_MS = 90_000` and
`PRESENCE_REPORT_MS = 30_000` are plain data; the specs pass `now` as a string.

**Surface names.** `EClientSurface` moves into `packages/core` as a pure enum, and
`packages/protocol` re-exports it as `EStreamSurface`
(`packages/protocol/src/stream-constants.ts:57-61`), exactly as `ESessionStatus` is shared today.
Core must not import the protocol package, and the decision must not depend on a transport type.

### 4.3 The decision: two pure functions, one model

Two callers with different facts: the server knows devices and settings, the client knows its own
focus. One function over both would need a fact the caller does not have. So two functions share
the model and the copy, and both live in `packages/core/src/notify/`.

```ts
// packages/core/src/notify/model.ts
export type AtlasNotification = {
  sessionId: string
  seq: number
  moment: ENotifyMoment
  title: string
  body: string
  at: string
}

// packages/core/src/notify/plan.ts — the server
export type NotifyPresence = {
  surface: EClientSurface
  sessionId: string | null
  foreground: boolean
  at: string
}

export type NotifyFacts = {
  moment: ENotifyMoment
  sessionId: string
  sessionTitle: string | null
  seq: number
  readSeq: number | null
  presence: readonly NotifyPresence[]
  devices: number
  quiet: boolean
  enabled: boolean
  now: string
}

export enum ENotifyMode {
  InApp = 'in-app',
  Push = 'push',
}

export const notifyPlanOf = (args: {
  facts: NotifyFacts
}): { mode: ENotifyMode; notification: AtlasNotification } | null
```

Rules in order; each returns `null` (stay silent):
1. `enabled === false` — the settings page has this moment off.
2. `quiet === true` — inside quiet hours.
3. `readSeq !== null && readSeq >= seq` — already read; the dot is dark.
4. a fresh presence record with `sessionId === sessionId && foreground` — the session is on screen.
5. a fresh presence record with `foreground` — you are in Atlas, in another session: `InApp`. The
   server sends nothing; rule 5 exists so the server never pushes while a client is in front.
6. `devices === 0` — no target.
7. otherwise `Push`.

```ts
// packages/core/src/notify/in-app.ts — the client
export const inAppNoticeOf = (args: {
  moment: ENotifyMoment
  sessionId: string
  sessionTitle: string | null
  seq: number
  readSeq: number | null
  onScreen: boolean
  focused: boolean
  enabled: boolean
}): AtlasNotification | null
```

Silent when the moment is off, when the window is not focused (the OS path owns that case), when
this session is on screen, or when `readSeq >= seq`. Otherwise a notice. `copy.ts` holds the words
once for both: the session title as the title, and `Finished`, `Failed — open Atlas to see why`,
`Atlas needs you` as the body. The `seq` of a moment is the seq of the `turn-ended` event the host
appended, so `readSeq >= seq` means the same thing as "the dot is dark".

Nothing in core reads a clock, a socket or a database. `now`, `at` and `readSeq` arrive as data.

### 4.4 `packages/notifications`: a package, not a plugin

**Why a package.** A v2 plugin declares events, views, commands, pod handlers and client state for
one feature inside one session, is optional, and may not import another plugin
(`docs/v2/slices/07-plugins.md` §Goal, §1). Notifications is the opposite of all four: it is
cross-cutting (every session, every surface), it must run whether or not a plugin is installed, it
adds no event type and no command, and it has no pod side at all. The framework rule decides it:
behaviour shared by every feature goes in the framework, and a plugin declares only its specifics.
`packages/notifications` follows the same subpath idea without pretending to be a plugin.

**Shape.** Framework-free TypeScript, zod only, and a `/client` subpath that imports no Node
module.

```
packages/notifications/src/
  model.ts        AtlasNotification, NotifyDevice, ENotifyDeviceKind
  port.ts         NotificationTransport, NotifyResult
  transports/web-push.ts   server: VAPID sign, POST to the subscription, 404/410 → gone
  transports/expo.ts       server: Expo push service, receipts, DeviceNotRegistered → gone
  transports/apns.ts       server: APNs HTTP/2 with a token JWT, 410/Unregistered → gone
  client/in-app.ts         client: deliver = render a toast, clear = drop it
  client/mac-native.ts     client, Mac main process: register the token, remove a group
  client/presence.ts       the report loop: getters in, report() out, no DOM
  client/clear.ts          close tagged notifications on open
  README.md                the consumer README that `scripts/check-package-readmes.ts` requires
```

```ts
// packages/notifications/src/port.ts
export interface NotificationTransport {
  readonly kind: ENotifyDeviceKind
  deliver(args: {
    devices: readonly NotifyDevice[]
    notification: AtlasNotification
  }): Promise<readonly NotifyResult[]>
  clear(args: {
    devices: readonly NotifyDevice[]
    sessionId: string
  }): Promise<readonly NotifyResult[]>
}

export type NotifyResult = { deviceId: string; sent: boolean; gone?: boolean }
```

`gone` is how a dead token or a `410` subscription leaves the table. One port, four transports:
Web Push, Expo and Mac APNs run in the trigger task; the in-app notice runs in the client; the Mac
receive path runs in the Mac main process. A transport is the only place that knows a protocol, so
the host, the trigger task and every client call the same two methods. The pure decision stays in
core (§4.3) and the package holds no policy.

**The trigger rule.** The send task stays lightweight: one control-plane client, one Redis client,
two `fetch` callers, built by hand beside `routine-graph.ts`
(`apps/trigger/src/trigger/routine/routine-run.task.ts:1-15`) with a fake graph for the spec
(`apps/trigger/src/__tests__/routine-graph.fake.ts`). No Nest boot, no Nest module.

### 4.5 Web Push, and the service worker the web app does not have

**In scope now**, for the Home Screen web app and for desktop browsers. The pieces:
- **A service worker at `/sw.js`**, generated by a static route so it is source, typed by a test,
  and served inside the Next standalone build: `apps/web/src/app/sw.js/route.ts` returns the text
  from `apps/web/src/lib/service-worker-source.ts`. Scope is `/`, which is what a push
  subscription needs. The alternative, a hand-written `apps/web/public/sw.js`, is a plain file with
  no type and no test; the route wins.
- **The handler.** On `push`: parse `{type:'notification', notification}` → `showNotification`
  with `tag: sessionId`, `renotify: false`, `data: {sessionId, seq}`, so a second moment for the
  same session replaces the first. On `{type:'clear', sessionId}`: `getNotifications({tag})` then
  `close()` on each. On `notificationclick`: focus an existing window and post the session id, or
  `clients.openWindow('/?session=<id>')`.
- **Subscription.** `apps/web/src/lib/web-push.ts`: feature-detect `serviceWorker` and `PushManager`,
  register `/sw.js`, ask `Notification.requestPermission()` in response to a click on the Settings
  page, `pushManager.subscribe({userVisibleOnly: true, applicationServerKey})`, and post the
  subscription to `notifications.registerDevice`. Permission is requested from a button, never on
  load: iOS rejects a request that is not in response to a user action
  (<https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>).
- **Secrets.** A VAPID key pair in the encrypted tiers: `WEB_PUSH_PUBLIC_KEY`,
  `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` for the sender in `apps/trigger/.env.production.enc`,
  and the public key exposed to the page through the `env` block of `apps/web/next.config.ts:34-39`
  with the value in `apps/web/.env.production.enc`. Encrypt with `bunx dotenvx`, per `AGENTS.md`.
- **Dependency.** `web-push` (with its types) declared in `apps/trigger/package.json`. The isolated
  linker means an undeclared dependency will not resolve.

### 4.6 Expo on iOS

The second transport, and the only one that reaches a closed app on the phone today.
- **Table.** `packages/db/src/prisma/schema/v2/push-device.prisma`:
  `V2PushDevice { id, userId, kind, token @unique, clientId, label, disabledAt, lastSeenAt, createdAt }`,
  inside `namespace v2` like every v2 model (`session-view.prisma:1-11`). `kind` is `web-push`,
  `expo` or `apns-mac`. `token` is the Expo push token for `expo`, the endpoint for `web-push` (with
  the subscription keys in a `secret` column), and the APNs device token for `apns-mac`. `clientId` is
  the app's own install id, so the Home Screen
  web app and the iOS app on one phone are two rows and both may ring. Copy the v1 shape, never
  the v1 model (`user-config/push-device.prisma:2-16`).
- **Routes.** `notifications.registerDevice` / `unregisterDevice` / `listDevices` /
  `setDeviceEnabled` in the v2 router, schema in `packages/wire/src/notify-wire.ts`, mirroring
  `push-devices.router.ts:22-49`. The mobile client repoints
  `apps/mobile/src/push/push-api.ts:10-18` at them.
- **Payload.** `title` = session title, `body` = copy (§4.3), `collapseId: sessionId`,
  `threadId: sessionId`, `data: {sessionId, seq}`. The app's foreground handler keeps the banner
  away while `AppState === 'active'` and the in-app toast takes over (§4.8).
- **Clear.** A headless background notification (`{data:{clearSessionId}, contentAvailable:true}`),
  handled by the task that already exists (`apps/mobile/src/push/background-notifications.ts:7-22`)
  → `dismissPresentedForThread` for the session (`notification-handler.ts:23-33`). Keep
  `enableBackgroundRemoteNotifications` (`apps/mobile/app.config.ts:29`).

### 4.7 Mac native: APNs, shown by the system and cleared by the app

The third server transport, and the only one that reaches a quit app on a computer.
- **Registration.** At `app.whenReady()` (`apps/mac/main.js:274-279`) the main process calls
  `pushNotifications.registerForAPNSNotifications()` and hands the token to the desktop host, which
  already holds the bearer token and its own device id (`apps/mac/src/host/index.ts:65-80`). The host
  calls `notifications.registerDevice({kind: 'apns-mac', token, clientId: deviceId, label: 'Mac'})`
  through `createApiClient`, as it does for its other calls
  (`apps/mac/src/host/auth/auth-service.ts:1,62`).
- **Send.** The `apns` transport POSTs an alert to `api.push.apple.com/3/device/<token>` with
  `apns-topic: io.byatlas.mac`, `apns-push-type: alert` and `apns-collapse-id: sessionId`, so a second
  moment for one session replaces the first. Title and body are the copy of §4.3; `{sessionId, seq}`
  rides beside `aps`. Apple answers `410 Unregistered` for a dead token, and the transport reports
  `gone` (§4.4).
- **While it runs.** The system draws the alert, so the app draws nothing for it. Presence already
  stopped the send when an Atlas window was in front (§4.3), so the Mac is never interrupted at the
  keyboard.
- **Clear.** A `content-available` push with `{sessionId}` makes the running app call
  `Notification.removeGroup(sessionId)`; `groupId` maps to macOS's `threadIdentifier`
  (<https://www.electronjs.org/docs/latest/api/notification>). A quit app removes its groups at the
  next launch, from `Notification.getHistory()` filtered by `groupId`.

### 4.8 In Atlas, in another session: the in-app transport

A client renders the notice itself. It already holds the events of every session it follows, so it
runs `notifyMomentOf` and `inAppNoticeOf` on the frames it receives and needs no server call.
- **Web and Mac.** A toast (`sonner` is already in the dependency list, e.g.
  `apps/web/src/features/sessions/session-view.tsx:4`), a clickable row that opens the session, and
  the existing unread dot (`apps/web/src/features/shell/v2-status.ts:57-61`). The toast is the only
  signal inside the app on the Mac: the Mac's OS banner comes from APNs (§4.7), so the Mac raises no
  second one. A desktop browser, which has no APNs, also raises a page-level
  `new Notification(title, {tag: sessionId})` while the window is visible but not focused, and keeps
  the object per tag so it can `close()` it.
- **iOS.** The app already receives the frames, and its push arrives through the same handler. With
  `AppState === 'active'` the handler shows no banner, so the app draws an in-app banner instead.
- **Clear.** When the session opens, or when `readSeq` reaches the notice's `seq`, the client drops
  the toast and closes its tagged notification.

### 4.9 Show and clear, per surface: what is guaranteed and what is best effort

| Surface                       | Notify when not in front                        | Clear on open, same device                | Clear from another device                         |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| Home Screen web app / browser | Web Push → OS notification                      | `getNotifications({tag}).close()` on open | Clear push, then `close()` (§4.10)                |
| iOS app (Expo)                | APNs notification                               | dismissal on foreground                   | headless push, then dismiss                       |
| Mac app (Electron)            | APNs → OS notification, running, hidden or quit | `removeGroup(sessionId)` on open          | clear push, then `removeGroup` at the next launch |
| Any open client               | in-app only                                     | toast and tag dropped at once             | on the next focus, from `readSeq`                 |

**Web Push cannot send a silent clear on Apple platforms.** WebKit requires a visible notification
for every push: "WebKit requires you as the developer to always show a notification; no silent push
messages are allowed… Violations of the `userVisibleOnly` promise will result in a push subscription
being revoked"
(<https://webkit.org/blog/16535/meet-declarative-web-push/>). So on a subscription whose endpoint is
Apple's, the clear is not a push: the web app closes its tagged notifications on its next open, and
until then the notification stays in the notification centre until the operator dismisses it. On
Chromium and Firefox a push whose handler shows nothing is allowed; Chrome's heuristics may still
add a generic notice, so the live check looks for that, and if it appears the clear push is dropped
for that browser family too. The clear push also never runs on a client that has no subscription.

**iOS background push is best effort.** Apple may delay or drop it, and Expo documents Apple's
advice to send no more than two or three per hour
(<https://docs.expo.dev/push-notifications/what-you-need-to-know/>, and
<https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app>).
So the phone also dismisses, on every foreground, the presented notifications whose session is
already read by the `readSeq` it syncs from the stream. `collapseId: sessionId` bounds the damage
to one stale banner if the background push never arrives.

**What is guaranteed.** In-app state clears at once on every open client that is running, because
each one reads the same `readSeq`. The unread dot is always right. **What is best effort.** An OS
notification leaves a closed app's notification centre when that app is told to clear it; the OS
may ignore the instruction, and then the operator dismisses it by hand. The product never depends
on it: the dot is the durable signal.

### 4.10 The clear path

One path, expressed once: "the session is read" → every enabled device of the user gets `clear`.
- **Trigger.** `markSessionRead` (`packages/control/src/session-ops.ts:88`, reached from
  `sessions.router.ts:160-164`) advances `readSeq`; the API then dispatches `notify-clear`
  `{userId, sessionId}` with idempotency key `notify-clear:<sessionId>:<readSeq>`. No ledger and no
  `lastNotifiedSeq`: a clear that finds nothing is a few HTTP calls, and one user has a handful of
  devices. That deletes v1's push-ledger idea instead of porting it.
- **Task.** `apps/trigger/src/trigger/notify/notify-clear.task.ts` reads the devices, calls each
  transport's `clear`, prunes anything that reports `gone`. Web Push subscriptions hosted by Apple
  are skipped (§4.9). An `apns-mac` device gets `content-available`, which the app reads only while
  it runs.
- **Client side.** Any client that opens the session closes its own tagged notifications and drops
  its toast, before the network call returns, so opening feels instant.

### 4.11 Where each piece runs

| Piece             | Runs on                                          | Notes                                                                              |
| ----------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Presence report   | web, Mac and iOS clients                         | §4.2, a mutation, 30 s repeat                                                      |
| Presence store    | API → Redis                                      | hash per user, 90 s TTL                                                            |
| Moment detection  | agent host holder, at the append                 | `notifyMomentOf` over what the holder computed                                     |
| Dispatch          | agent host → `JobDispatcher`                     | `notify-send` `{sessionId, threadId, seq, moment}`, key `notify:<sessionId>:<seq>` |
| Decision and send | trigger task `notify-send`                       | reads the session, presence, devices, settings; `notifyPlanOf`; transports         |
| In-app notice     | each client, from its own stream                 | no server involvement                                                              |
| Mac receive       | `apps/mac/main.js` main process                  | `pushNotifications` registration; `Notification.removeGroup` on a clear            |
| Registration      | v2 tRPC mutation                                 | `V2PushDevice` rows                                                                |
| Clear             | trigger task `notify-clear` + the opening client | §4.10                                                                              |

Two anchors for the host side. The port goes beside the existing one
(`apps/api/src/agent/host/pod-disk-pressure.port.ts:11-33`), built from `JobDispatcher`, with its
contract in `apps/api/src/agent/host/notify-send.contract.ts` and a zod schema in
`packages/jobs/src/index.ts` beside the routine ids (`:3-29`). The call sites are the end of
`HeldTurns.endTurn` (`packages/host/src/holder/held-turns.ts:131-158`) and the parked path, where
the appended events give the seq. A dispatch failure is logged and never blocks or fails the turn.

### 4.12 Settings, and where the choice is stored

`/settings/notifications` already exists (`apps/web/src/features/settings/pages/notifications.tsx`).
It gets three real parts and loses the rest:
- **Per-event toggles**: three switches — finished, failed, waiting for you — bound to the existing
  keys `web.notifications.event.{finished,errored,approval}.push`
  (`packages/core/src/settings/cloud/web-only-settings.ts:22-38`). The matrix's `inApp` and `email`
  columns go, and so do the `checks`, `mention` and `paused` rows, which have no v2 source.
- **Devices**: a list from `notifications.listDevices`, one row per device with its label, its
  surface and a switch → `setDeviceEnabled` (writes `V2PushDevice.disabledAt`). A disabled device
  keeps its row and receives nothing.
- **Quiet hours**: the existing `quietHours`, `quietFrom`, `quietTo` keys (`:70-80`) and the existing
  two selects (`apps/web/src/features/settings/parts/interface-quiet-hours.tsx`), plus a time-zone
  field stored in `web.notifications.timezone` and defaulted to
  `Intl.DateTimeFormat().resolvedOptions().timeZone` on first load. Quiet hours need a zone; with no
  zone they do nothing, which is honest and cheap.

**Storage decision.** Settings stay in the settings registry: `UserSetting` rows per user, validated
by one zod entry per key in core, served by `settings.router.ts:21-36`, which is exactly what the
page already reads and writes (`apps/web/src/lib/cloud-settings.ts:19-31`). Devices go in
`V2PushDevice` rows instead, because a device is data, not a preference: it has a unique token, a
last-seen time and a lifecycle of its own. The registry holds scalars only.

## 5. Slices

Each slice is one PR that merges alone, in this order.
1. **The decision and the package.** `packages/core/src/notify/{moment,plan,in-app,copy,presence,model}.ts`
   with specs; `packages/notifications/` with model, port, `README.md`, `package.json`; the core
   re-export beside the record exports. No caller, so zero risk, and it reviews as pure logic.
   Files: `packages/core/src/notify/**`, `packages/notifications/**`.
2. **Presence.** `packages/wire/src/notify-wire.ts` (report input), the mutation in the v2 router,
   `apps/api/src/api/platform/control/presence-registry.ts` and its Redis client, the web hook
   `apps/web/src/features/sessions/data/use-presence-report.ts`, the iOS hook in
   `apps/mobile/src/thread/v2/`, the shared loop from `packages/notifications/src/client/presence.ts`.
   No user-visible change, so it can merge before anything reads presence.
   Files: `packages/wire/src/notify-wire.ts`, `apps/api/src/api/platform/control/`,
   `apps/web/src/features/sessions/data/`, `apps/mobile/src/thread/v2/`,
   `packages/notifications/src/client/presence.ts`.
3. **In Atlas.** The toast and the page notification, click to open, and clearing from `readSeq`, on
   web and in the iOS app. Needs only the stream, so it delivers value on its own.
   Files: `packages/notifications/src/client/{in-app,clear}.ts`,
   `apps/web/src/features/notifications/`, `apps/web/src/features/shell/`,
   `apps/mobile/src/notifications/`.
4. **Web Push, and the first moment end to end.** The largest slice, and it can split at the task
   boundary if review needs it: the `V2PushDevice` model and migration, register/list/unregister
   mutations, the send dispatch port and its two call sites, the `notify-send` task with the
   presence read and `notifyPlanOf`, the Web Push transport, the service worker route and its
   registration, the VAPID secrets, `web-push` in `apps/trigger/package.json`, and a
   "Send a test notification" button on the settings page so the transport is provable before the
   moments are trusted.
   Files: `packages/db/src/prisma/schema/v2/push-device.prisma` + migration,
   `packages/jobs/src/index.ts`, `apps/api/src/agent/host/{notify-send.contract,notify.port}.ts`,
   `packages/host/src/holder/held-turns.ts`, `apps/trigger/src/trigger/notify/`,
   `packages/notifications/src/transports/web-push.ts`, `apps/web/src/app/sw.js/route.ts`,
   `apps/web/src/lib/{web-push,service-worker-source}.ts`, `apps/web/next.config.ts`.
5. **Expo on iOS.** The second transport, the mobile client repoint, the foreground suppressor and
   the in-app banner, the push payload and its collapse id.
   Files: `packages/notifications/src/transports/expo.ts`,
   `apps/mobile/src/push/`, `apps/mobile/src/notifications/`, `apps/mobile/app.config.ts`.
6. **Mac native (APNs).** The third transport; the entitlement, the provisioning profile and the four
   APNs secrets; the `apns-mac` device kind; registration from the Mac main process through the
   desktop host; the `content-available` clear. The settings page's test button must reach the Mac
   before the moments trust this path.
   Files: `packages/notifications/src/transports/apns.ts`,
   `packages/notifications/src/client/mac-native.ts`, `apps/mac/main.js`, `apps/mac/src/host/`,
   `apps/mac/build/entitlements.mac.plist`, `apps/mac/electron-builder.yml`,
   `packages/db/src/prisma/schema/v2/push-device.prisma` + migration,
   `apps/trigger/src/trigger/notify/`.
7. **Clear everywhere.** `notify-clear` from `markSessionRead`, the clear task, the Apple skip, the
   APNs clear, and the dismiss-on-foreground safety net.
   Files: `apps/trigger/src/trigger/notify/notify-clear.task.ts`,
   `apps/api/src/api/platform/control/sessions.router.ts`,
   `packages/notifications/src/transports/{web-push,expo,apns}.ts`,
   `apps/mobile/src/push/notification-handler.ts`, `packages/jobs/src/index.ts`.
8. **Settings.** The three toggles, the device list, quiet hours and the time-zone field, read into
   `NotifyFacts` by the task.
   Files: `apps/web/src/features/settings/pages/notifications.tsx`,
   `apps/web/src/features/settings/parts/`, `apps/web/src/features/settings/data/personal/interface-settings.ts`,
   `packages/core/src/settings/cloud/web-only-settings.ts`, `apps/trigger/src/trigger/notify/`.

## 6. Test plan and a live check

- **Core** (`packages/core/src/notify/__tests__/`): `notifyMomentOf` for each ending, the parked
  and waiting statuses, and an operator stop; `notifyPlanOf` for read, on screen, in another
  session, quiet, disabled, no devices, and the message it returns (title, body, `seq`); the same
  for `inAppNoticeOf`; `presenceIsFresh` at 89 s and 91 s; a `fast-check` case that "on screen"
  always beats "in another session", which beats push.
- **Package** (`packages/notifications/src/__tests__/`): the Web Push transport signs and posts,
  maps `404` and `410` to `gone`, and builds the right `tag` and `data`; the Expo transport builds
  the payload and maps `DeviceNotRegistered` to `gone`; the APNs transport builds the request with
  its topic, push type and collapse id, signs its token and maps `410 Unregistered` to `gone`; the
  client loop reports on change, repeats while foreground, reports away on blur and on `pagehide`,
  and stops when the app goes inactive.
- **Service worker** (`apps/web/src/lib/__tests__/service-worker-source.spec.ts`): the generated
  source reads the same payload keys as the model, shows with `tag: sessionId`, and closes by tag.
- **API** (`apps/api/src/api/platform/control/presence-registry.spec.ts` and
  `notifications.router.spec.ts`): a report writes the field with its surface, an away report
  deletes it, and an expired field never counts. (`apps/api/src/agent/host/__tests__`):
  a turn that ends dispatches one job with the moment and the appended seq; a parked turn dispatches
  `waiting-for-you`; an operator stop dispatches nothing; a dispatcher failure leaves the turn green.
- **Trigger** (fake graph, like `routine-graph.fake.ts`): presence in front of another session sends
  nothing; no presence with two devices sends two messages with the same `collapseId`; a dead token
  is pruned; the clear sends to every enabled device and skips an Apple endpoint.
- **Web** (`apps/web`): the toast appears for a session that is not on screen and not for the open
  one; the page notification is created with `tag: sessionId` and closed when `readSeq` reaches its
  seq; the device list shows a disabled device.
- **Mobile** (`apps/mobile`): registration sends `kind` and `clientId`; a clear payload dismisses
  exactly that session's notifications; the foreground handler still suppresses banners.
- **Mac** (`apps/mac`): the token from `pushNotifications` reaches `registerDevice` once, with kind
  `apns-mac` and the host's device id; a clear removes one group and no other. The receive path is a
  pure function in `packages/notifications/src/client/mac-native.ts` with its spec, so the Electron
  caller stays thin.
- **Live check.** On the Mac, the iPhone and the Home Screen web app: start a v2 session, look at it
  on the Mac, let the turn end — nothing anywhere. Look at another session on the Mac, let a turn
  end — a toast on the Mac, nothing on the phone, nothing on the web app. Blur every window (do not
  close them), let a turn end — the phone, the web app and the Mac each show one notification. Quit
  the Mac app, let another turn end — the Mac still shows one, and the app removes the group when it
  next launches. Start another turn — still one per device, replaced. Open the session on the phone —
  it goes from the phone, the web app and the Mac; the dot is gone everywhere. Repeat on the settings
  page with quiet hours on, and with one device disabled.

## 7. Out of scope

- v1 sessions, the TUI, email, and notification actions (reply, approve, stop).
- A background or login-item process for the Mac app. With APNs the system delivers, so Atlas needs
  no always-running process (§2).
- Declarative Web Push (`web_push: 8030`), which would let Safari show a notification without our
  service worker. It is a later optimisation, and the service worker path works on Safari today.
- Per-session mute, per-device sound and badge choices, "snooze", and a helper that names the
  teammate or sub-agent that needs you.
- A sweep that finds a moment the host failed to dispatch. Notification is best effort; a missed one
  leaves the unread dot, which is the durable signal.
