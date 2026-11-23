export const SERVICE_WORKER_PATH = '/sw.js'

export const PUSH_MESSAGE_NOTIFICATION = 'notification'

export const PUSH_MESSAGE_CLEAR = 'clear'

export const OPEN_SESSION_MESSAGE = 'open-session'

export const SESSION_QUERY_PARAM = 'session'

export const ROUTINE_PATH = '/routines/'

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

const openSession = async (sessionId) => {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const existing = windows[0]
  if (existing === undefined) {
    await self.clients.openWindow('/?${SESSION_QUERY_PARAM}=' + encodeURIComponent(sessionId))
    return
  }
  existing.postMessage({ type: '${OPEN_SESSION_MESSAGE}', sessionId })
  await existing.focus()
}

const openRoutine = async (routineId) => {
  const url = '${ROUTINE_PATH}' + encodeURIComponent(routineId)
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const existing = windows[0]
  if (existing === undefined) {
    await self.clients.openWindow(url)
    return
  }
  await existing.focus()
  await existing.navigate(url).catch(() => self.clients.openWindow(url))
}

self.addEventListener('push', (event) => {
  const message = notificationOf(event)
  if (message === null) return
  if (message.type === '${PUSH_MESSAGE_NOTIFICATION}') {
    const notification = message.notification
    event.waitUntil(
      self.registration.showNotification(notification.title, {
        body: notification.body,
        tag: notification.sessionId,
        renotify: false,
        data: {
          sessionId: notification.sessionId,
          seq: notification.seq,
          routineId: notification.routineId,
        },
      }),
    )
    return
  }
  if (message.type === '${PUSH_MESSAGE_CLEAR}') event.waitUntil(closeTagged(message.sessionId))
})

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data
  event.notification.close()
  if (typeof data.routineId === 'string') {
    event.waitUntil(openRoutine(data.routineId))
    return
  }
  event.waitUntil(openSession(data.sessionId))
})
`
