# @dltech/atlas-notifications

The device model and the transport port that every notification path uses. The trigger task and
the clients call one interface, and each transport knows only its own protocol.

## Owns

- The device kinds: Web Push, Expo and Mac APNs.
- The device shape that a transport receives.
- The transport interface, with `deliver` and `clear`, and its result type.

## Does not own

- The decision to notify. `@dltech/atlas-core` owns it in `notifyPlanOf` and `inAppNoticeOf`.
- The notification shape. `@dltech/atlas-core` owns `AtlasNotification`.
- The persistent device rows. `packages/db` owns them.
- The transport implementations and the send tasks. Later slices add them.

## Entry points

| Import                        | Use it for                                    |
| ----------------------------- | --------------------------------------------- |
| `@dltech/atlas-notifications` | The device model and the transport interface. |

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

## Rules

- Give each device to the transport of its own kind. The transport does not filter the list.
- Set `gone` to true only when the provider says the token is dead. The caller removes the row.
- Do not put policy in a transport. The decision belongs to `@dltech/atlas-core`.

## See also

- `docs/v2/specs/notifications.md` gives the design.
- `@dltech/atlas-core` gives `AtlasNotification`, `notifyPlanOf` and `inAppNoticeOf`.
