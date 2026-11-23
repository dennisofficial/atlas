import { resolveApiOrigin } from './api-origin'

export const SERVICE_WORKER_PATH = '/sw.js'

export const PUSH_MESSAGE_NOTIFICATION = 'notification'

export const PUSH_MESSAGE_CLEAR = 'clear'

export const ROUTINE_PATH = '/routines/'

export const SESSION_PATH = '/sessions/'

export const WEB_PUSH_DEVICE_KIND = 'web-push'

export const TRACK_PATH = '/v1/trpc/notifications.track'

export const serviceWorkerApiBase = resolveApiOrigin({
  ATLAS_API_ORIGIN: process.env.ATLAS_API_ORIGIN,
  VERCEL_ENV: process.env.VERCEL_ENV,
})

export const serviceWorkerSource = `self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

const notificationOf = (event) => {
  try {
    return event.data.json()
  } catch {
    return null
  }
}

const closeTagged = async (sessionId) => {
  const shown = await self.registration.getNotifications({ tag: sessionId })
  for (const notification of shown) notification.close()
}

const open = async (url) => {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const existing = windows[0]
  if (existing === undefined) {
    await self.clients.openWindow(url)
    return
  }
  await existing.focus()
  await existing.navigate(url).catch(() => self.clients.openWindow(url))
}

const openSession = (sessionId) => open('${SESSION_PATH}' + encodeURIComponent(sessionId))

const openRoutine = (routineId) => open('${ROUTINE_PATH}' + encodeURIComponent(routineId))

const track = (event, data) => {
  if (data === undefined || typeof data.sessionId !== 'string') return Promise.resolve()
  if (typeof data.routineId === 'string') return Promise.resolve()
  const body = {
    event,
    sessionId: data.sessionId,
    seq: data.seq,
    moment: data.moment,
    deviceKind: '${WEB_PUSH_DEVICE_KIND}',
  }
  if (typeof data.sentAt === 'string') body.sentAt = data.sentAt
  return fetch('${serviceWorkerApiBase}${TRACK_PATH}', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(
    () => undefined,
    () => undefined,
  )
}

self.addEventListener('push', (event) => {
  const message = notificationOf(event)
  if (message === null) return
  if (message.type === '${PUSH_MESSAGE_NOTIFICATION}') {
    const notification = message.notification
    const data = {
      sessionId: notification.sessionId,
      seq: notification.seq,
      routineId: notification.routineId,
      moment: notification.moment,
      sentAt: notification.at,
    }
    event.waitUntil(
      Promise.all([
        self.registration.showNotification(notification.title, {
          body: notification.body,
          tag: notification.sessionId,
          renotify: false,
          silent: notification.silent === true,
          data,
        }),
        track('delivered', data),
      ]),
    )
    return
  }
  if (message.type === '${PUSH_MESSAGE_CLEAR}') event.waitUntil(closeTagged(message.sessionId))
})

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data
  event.notification.close()
  const tracked = track('opened', data)
  if (typeof data.routineId === 'string') {
    event.waitUntil(tracked.then(() => openRoutine(data.routineId)))
    return
  }
  event.waitUntil(tracked.then(() => openSession(data.sessionId)))
})

self.addEventListener('notificationclose', (event) => {
  event.waitUntil(track('dismissed', event.notification.data))
})
`
