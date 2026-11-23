# @dltech/atlas-notifications

The device model and the transport port that every notification path uses. The trigger task and
the clients call one interface, and each transport knows only its own protocol. The `/client`
subpath finds the moment in a sessions list, turns it into an in-app notice, and reports
presence. The `/server` subpath stores presence in Redis.

## Owns

- The device kinds: Web Push, Expo and Mac APNs.
- The device shape that a transport receives.
- The transport interface, with `deliver` and `clear`, and its result type.
- The in-app notice: which sessions list row changed, and which notice to show or drop.
- The presence store that the API writes and the trigger task reads.
- The client presence loop that web, Mac and iOS run.
- The Web Push transport, which signs a message with VAPID and posts it to a subscription.

## Does not own

- The decision to notify. `@dltech/atlas-core` owns it in `notifyPlanOf` and `inAppNoticeOf`.
- The notification shape. `@dltech/atlas-core` owns `AtlasNotification`.
- When to stay silent. `@dltech/atlas-core` owns `inAppNoticeOf` and `notifyMomentOf`.
- The persistent device rows. `packages/db` owns them.
- The Expo and APNs transports. Later slices add them.
- The send tasks. `apps/trigger` owns them.

## Entry points

| Import                               | Use it for                                     |
| ------------------------------------ | ---------------------------------------------- |
| `@dltech/atlas-notifications`        | The device model and the transport interface.  |
| `@dltech/atlas-notifications/client` | The in-app notice and the presence loop.       |
| `@dltech/atlas-notifications/server` | The presence store and the Web Push transport. |

## Capabilities

### Name a device kind

- `ENotifyDeviceKind`: `WebPush` (`web-push`), `Expo` (`expo`) and `ApnsMac` (`apns-mac`).

### Describe a device

- `NotifyDevice`: an `id`, a `kind`, a `token` and a `secret`. The secret holds the Web Push
  subscription keys. It is `null` for Expo and APNs devices.

### Implement a transport

- `NotificationTransport`: one interface with a `kind`, `deliver` and `clear`.
- `NotifyResult`: the `deviceId`, the flag `sent`, and the optional flag `gone`. A transport sets
  `gone` to true when the device token is dead, so the caller can remove the device row.

### Find the moment in a sessions list

- `InAppRow`: one row of the list. It holds the session id, the title, the status, the read
  marker, the head seq and the last turn ending.
- `inAppRowOf`: reads a session summary into a row.
- `inAppMomentsOf`: gives the rows that changed since the previous list. It says nothing for the
  first list. A row gives a moment when its last turn ending is newer, or when its status newly
  waits for the operator. A new row gives nothing.
- `inAppNoticesOf`: gives the notices to show. It calls `inAppNoticeOf` for each moment, so a row
  that is on screen, a window that is not focused, a disabled moment and a read row stay silent.
- `staleNoticeIdsOf`: gives the session ids whose notice must go. A notice goes when its session
  opens, or when the read marker reaches its seq.

### Store presence

- `presenceKeyOf`: the Redis hash key of one user, `atlas:v2:presence:<userId>`.
- `PresenceHash`: the Redis commands the store uses. Pass an ioredis client or a fake.
- `writePresence`: writes the field of one client. An away report deletes the field.
- `readPresence`: returns the fresh records only. A record older than 90 s never counts.

### Send Web Push

- `webPushTransport({ vapid, send })`: the `web-push` kind. `vapid` is `publicKey`, `privateKey`
  and `subject`. Give `send` a fake in a spec.
- `deliver` posts `{ type: 'notification', notification }` with a one-day TTL and a topic of the
  session id, so a second moment replaces the first.
- `clear` posts `{ type: 'clear', sessionId }`, and skips an Apple push host, which needs a visible
  notification for every push.
- A `404` or a `410` reports the device `gone`, as does a secret with no subscription keys.
- `webPushTopicOf(sessionId)` and `WEB_PUSH_TTL_S`: the topic and the lifetime.

### Report presence from a client

- `startPresenceReports`: reports on start, on every change of the session or the foreground
  flag, and again every 30 s while foreground. Returns a function that stops it.
- The caller gives `read`, `report`, `subscribe` and a `clock`. The package touches no DOM.

## Usage

### Show a notice

```ts
import { inAppRowOf, inAppNoticesOf, staleNoticeIdsOf } from '@dltech/atlas-notifications/client'

const rows = summaries.map(inAppRowOf)
const notices = inAppNoticesOf({
  previous,
  next: rows,
  openSessionId: null,
  focused: true,
  enabled: () => true,
  now,
})
const stale = staleNoticeIdsOf({
  notices,
  rows: new Map(rows.map((row) => [row.sessionId, row])),
  openSessionId: null,
})
```

### Report presence

```ts
import { startPresenceReports } from '@dltech/atlas-notifications/client'

const stop = startPresenceReports({
  read: () => ({ sessionId: 'session-1', foreground: true }),
  report: (state) => console.log(state),
  subscribe: (onChange) => {
    window.addEventListener('focus', onChange)
    return () => window.removeEventListener('focus', onChange)
  },
  clock: {
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id),
  },
})
```

## Rules

- Give each device to the transport of its own kind. The transport does not filter the list.
- Set `gone` to true only when the provider says the token is dead. The caller removes the row.
- Do not put policy in a transport. The decision belongs to `@dltech/atlas-core`.
- Keep `previous` from the last list. The first list gives no notice.
- Give each surface the same rows. The web app and the phone read the sessions list.
- Import `/server` only on a server. It needs Redis. Import `/client` in a browser or an app.
- Send an away report when the client leaves. Do not wait for the expiry.

## See also

- `docs/v2/slices/notifications.md` gives the design.
- `@dltech/atlas-core` gives `AtlasNotification`, `notifyPlanOf` and `inAppNoticeOf`.
