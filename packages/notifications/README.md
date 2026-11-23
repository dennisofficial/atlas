# @dltech/atlas-notifications

The device model and the transport port that every notification path uses. The trigger task and
the clients call one interface, and each transport knows only its own protocol. The `/client`
subpath reads a list and a Mac push, and reports presence. The `/server` subpath stores presence in
Redis and sends the pushes.

## Owns

- The device kinds: Web Push, Expo and Mac APNs.
- The device shape that a transport receives.
- The transport interface, with `deliver` and `clear`, and its result type.
- The in-app notice: which sessions list row changed, and which notice to show or drop.
- The presence store that the API writes and the trigger task reads.
- The client presence loop that web, Mac and iOS run.
- The Web Push transport, which signs a message with VAPID and posts it to a subscription.
- The Expo transport, which posts alerts and headless clears to the Expo push service.
- The APNs transport, which signs a provider token and posts an alert or a background push to Apple.
- The Mac push reader: what a received push means, and which groups to remove.

## Does not own

- The decision to notify or stay silent. `@dltech/atlas-core` owns `notifyPlanOf`, `inAppDueOf`
  and `inAppNoticeOf`, and the `AtlasNotification` shape.
- The persistent device rows. `packages/db` owns them.
- The send tasks. `apps/trigger` owns them.

## Entry points

| Import                               | Use it for                                                      |
| ------------------------------------ | --------------------------------------------------------------- |
| `@dltech/atlas-notifications`        | The device model, the payload keys and the transport interface. |
| `@dltech/atlas-notifications/client` | The in-app notice and the presence loop.                        |
| `@dltech/atlas-notifications/server` | The presence store, the Web Push, Expo and APNs transports.     |

## Capabilities

### Name a device kind

- `ENotifyDeviceKind`: `WebPush` (`web-push`), `Expo` (`expo`) and `ApnsMac` (`apns-mac`).

### Describe a device

- `NotifyDevice`: an `id`, a `kind`, a `token` and a `secret`. The secret holds the Web Push
  subscription keys. It is `null` for Expo and APNs devices.

### Name the payload keys

- `NOTIFY_DATA_SESSION_KEY` (`sessionId`), `NOTIFY_DATA_SEQ_KEY` (`seq`) and
  `NOTIFY_DATA_CLEAR_SESSION_KEY` (`clearSessionId`): the keys of the Expo and APNs payloads.
- `NOTIFY_DATA_ROUTINE_KEY` (`routineId`) and `routineDataOf(notification)`: a routine notice names
  its routine. A client opens the routine for it, never the `sessionId`.

### Implement a transport

- `NotificationTransport`: one interface with a `kind`, `deliver` and `clear`.
- `NotifyResult`: the `deviceId`, the flag `sent`, and the optional flag `gone`. A transport sets
  `gone` when the token is dead, so the caller can remove the row.

### Find the moment in a sessions list

- `InAppRow`: one row of the list. It holds the session id, the title, the status, the read
  marker, the head seq, whether the row is a nested session, and the last turn ending with its
  time and its notify facts.
- `inAppRowOf`: reads a session summary into a row.
- `HeldNotice`: a notice that waits for its turn: the session id, the turn seq and the due time.
- `inAppScanOf`: gives the notices to show now and the held notices to keep. It says nothing for
  the first list or a new row. A row gives a moment when its last turn ending is newer, or when
  its status newly waits for the operator. `inAppDueOf` decides whether the moment shows, stays
  silent or waits until a due time.
- `dueNoticesOf`: turns the held notices that are due into moments, and drops the ones a newer
  turn replaced, or whose session runs again.
- `earliestDueAt`: the first due time in a held list, so a caller arms one timer.
- `dueDelayMs`: the wait until a due time, never below zero.
- `staleNoticeIdsOf`: gives the session ids whose notice must go: its session opened, or the read
  marker reached its seq.

### Store presence

- `presenceKeyOf`: the Redis hash key of one user, `atlas:v2:presence:<userId>`.
- `PresenceHash`: the Redis commands the store uses. Pass an ioredis client or a fake.
- `writePresence`: writes the field of one client. An away report deletes the field.
- `readPresence`: returns the fresh records only. A record older than 90 s never counts.

### Send Web Push

- `webPushTransport({ vapid, send })`: the `web-push` kind. `vapid` is `publicKey`, `privateKey` and `subject`; give `send` a fake in a spec.
- `deliver` posts `{ type: 'notification', notification }` with a one-day TTL and a topic of the
  session id, so a second moment replaces the first.
- `clear` posts `{ type: 'clear', sessionId }`, and skips an Apple push host, which needs a visible
  notification for every push.
- A `404` or a `410` reports the device `gone`, as does a secret with no subscription keys.
- `webPushTopicOf(sessionId)` and `WEB_PUSH_TTL_S`: the topic and the lifetime.

### Send Expo push

- `expoTransport({ accessToken, fetch })`: the `expo` kind. `accessToken` is optional; `fetch` takes a fake in a spec.
- `deliver` posts an alert with the title, the body, `sound: 'default'`, the `collapseId` and `threadId` of the session, and `data: { sessionId, seq }`, at most 100 messages per request.
- `clear` posts `{ contentAvailable: true, data: { clearSessionId } }` with no title and no body.
- A ticket with `details.error === 'DeviceNotRegistered'` reports the device `gone`. A refused or
  unreachable request reports every device unsent.
- `EXPO_PUSH_URL` and `EXPO_PUSH_BATCH_SIZE`: the endpoint and the batch size.

### Send Mac push

- `apnsTransport({ keyP8, keyId, teamId, topic, send, clock })`: the `apns-mac` kind. `send` takes a fake in a spec.
- `deliver` posts an alert to `api.push.apple.com/3/device/<token>` with `apns-topic`, `apns-push-type: alert` and the session as `apns-collapse-id`, so a second moment replaces the first.
- `clear` posts `apns-push-type: background` with priority 5 and no alert.
- The provider token is an ES256 JWT of `{ iss: teamId, iat }` with `{ alg, kid }`, cached for 50 minutes.
- A `410`, `Unregistered` or `BadDeviceToken` reports the device `gone`.
- `APNS_ORIGIN`, `APNS_TOKEN_TTL_MS` and `apnsCollapseIdOf(sessionId)`: the host, the token lifetime and the collapse id, cut to 64 bytes.

### Read a Mac push

- `macPushOf(userInfo)`: a clear, a notification with its `seq`, or nothing for a payload it does not know.
- `groupsToRemove({ history, sessionId | readSessionIds })`: the distinct group ids that a notification history holds for those sessions.
- `EMacPush`: `Clear` and `Notification`.

### Report presence from a client

- `startPresenceReports({ read, report, subscribe, clock })`: reports on start, on every change and every 30 s while foreground. Returns a stop function. The package touches no DOM.

## Usage

### Show a notice

```ts
import { inAppRowOf, inAppScanOf, earliestDueAt } from '@dltech/atlas-notifications/client'

const rows = summaries.map(inAppRowOf)
const scan = inAppScanOf({ previous, next: rows, held, openSessionId, focused, enabled, now })
const nextTimerAt = earliestDueAt(scan.held)
```

## Rules

- Give each device to the transport of its own kind. The transport does not filter the list.
- Set `gone` to true only when the provider says the token is dead. The caller removes the row.
- Do not put policy in a transport. The decision belongs to `@dltech/atlas-core`.
- Keep `previous` from the last list. The first list gives no notice.
- Give each surface the same rows. The web app and the phone read the sessions list.
- Import `/server` only on a server. It needs Redis. Import `/client` in a browser or an app.
- An APNs token is the device token; the transport signs its own provider token.

## See also

- `docs/v2/slices/notifications.md` gives the design.
- `@dltech/atlas-core` gives `AtlasNotification`, `notifyPlanOf` and `inAppNoticeOf`.
