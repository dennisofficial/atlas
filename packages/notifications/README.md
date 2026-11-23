# @dltech/atlas-notifications

The device model and the transport port that every notification path uses. The trigger task and
the clients call one interface, and each transport knows only its own protocol. The `/client`
subpath finds the moment in a sessions list and turns it into an in-app notice.

## Owns

- The device kinds: Web Push, Expo and Mac APNs.
- The device shape that a transport receives.
- The transport interface, with `deliver` and `clear`, and its result type.
- The in-app notice: which sessions list row changed, and which notice to show or drop.

## Does not own

- The decision to notify. `@dltech/atlas-core` owns it in `notifyPlanOf` and `inAppNoticeOf`.
- The notification shape. `@dltech/atlas-core` owns `AtlasNotification`.
- When to stay silent. `@dltech/atlas-core` owns `inAppNoticeOf` and `notifyMomentOf`.
- The persistent device rows. `packages/db` owns them.
- The transport implementations and the send tasks. Later slices add them.

## Entry points

| Import                               | Use it for                                    |
| ------------------------------------ | --------------------------------------------- |
| `@dltech/atlas-notifications`        | The device model and the transport interface. |
| `@dltech/atlas-notifications/client` | The in-app notice for a sessions list.        |

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

## Usage

```ts
import {
  ENotifyDeviceKind,
  type NotificationTransport,
  type NotifyDevice,
} from '@dltech/atlas-notifications'

const transport: NotificationTransport = {
  kind: ENotifyDeviceKind.Expo,
  deliver: async (args) => args.devices.map((device) => ({ deviceId: device.id, sent: true })),
  clear: async (args) => args.devices.map((device) => ({ deviceId: device.id, sent: true })),
}

const devices: readonly NotifyDevice[] = [
  { id: 'device-1', kind: ENotifyDeviceKind.Expo, token: 'ExponentPushToken[abc]', secret: null },
]
```

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
  now: new Date().toISOString(),
})
const stale = staleNoticeIdsOf({
  notices,
  rows: new Map(rows.map((row) => [row.sessionId, row])),
  openSessionId: null,
})
```

## Rules

- Give each device to the transport of its own kind. The transport does not filter the list.
- Set `gone` to true only when the provider says the token is dead. The caller removes the row.
- Do not put policy in a transport. The decision belongs to `@dltech/atlas-core`.
- Keep `previous` from the last list. The first list gives no notice.
- Give each surface the same rows. The web app and the phone read the sessions list.

## See also

- `docs/v2/specs/notifications.md` gives the design.
- `@dltech/atlas-core` gives `AtlasNotification`, `notifyPlanOf` and `inAppNoticeOf`.
