import { describe, expect, it } from 'bun:test'

import {
  PUSH_MESSAGE_CLEAR,
  PUSH_MESSAGE_NOTIFICATION,
  ROUTINE_PATH,
  SERVICE_WORKER_PATH,
  SESSION_PATH,
  serviceWorkerSource,
} from '../service-worker-source'

describe('the service worker source', () => {
  it('is served from the path the browser registers', () => {
    expect(SERVICE_WORKER_PATH).toBe('/sw.js')
  })

  it('parses as JavaScript', () => {
    expect(() => new Function(serviceWorkerSource)).not.toThrow()
  })

  it('reads the same message and notification keys as the model', () => {
    expect(serviceWorkerSource).toContain(`message.type === '${PUSH_MESSAGE_NOTIFICATION}'`)
    expect(serviceWorkerSource).toContain(`message.type === '${PUSH_MESSAGE_CLEAR}'`)
    expect(serviceWorkerSource).toContain('message.notification')
    expect(serviceWorkerSource).toContain('notification.title')
    expect(serviceWorkerSource).toContain('notification.body')
    expect(serviceWorkerSource).toContain('notification.sessionId')
    expect(serviceWorkerSource).toContain('notification.seq')
  })

  it('shows a notification tagged by session so a second moment replaces the first', () => {
    expect(serviceWorkerSource).toContain('self.registration.showNotification(notification.title')
    expect(serviceWorkerSource).toContain('tag: notification.sessionId')
    expect(serviceWorkerSource).toContain('renotify: false')
    expect(serviceWorkerSource).toContain('sessionId: notification.sessionId,')
    expect(serviceWorkerSource).toContain('seq: notification.seq,')
    expect(serviceWorkerSource).toContain('routineId: notification.routineId,')
  })

  it('opens the routine page, not a session, when the notice names a routine', () => {
    expect(serviceWorkerSource).toContain("if (typeof data.routineId === 'string')")
    expect(serviceWorkerSource).toContain('openRoutine(data.routineId)')
    expect(serviceWorkerSource).toContain(`'${ROUTINE_PATH}' + encodeURIComponent(routineId)`)
  })

  it('closes the notifications of a session by tag', () => {
    expect(serviceWorkerSource).toContain('self.registration.getNotifications({ tag: sessionId })')
    expect(serviceWorkerSource).toContain('notification.close()')
  })

  it('opens the session page a tap names', () => {
    expect(serviceWorkerSource).toContain('openSession(data.sessionId)')
    expect(serviceWorkerSource).toContain(`open('${SESSION_PATH}' + encodeURIComponent(sessionId))`)
  })

  it('routes a tap into an existing window before opening a new one', () => {
    expect(serviceWorkerSource).toContain('existing.focus()')
    expect(serviceWorkerSource).toContain(
      'await existing.navigate(url).catch(() => self.clients.openWindow(url))',
    )
    expect(serviceWorkerSource).toContain(
      'const existing = windows[0]\n  if (existing === undefined) {\n    await self.clients.openWindow(url)',
    )
  })

  it('navigates a window it cannot post to instead of messaging it', () => {
    expect(serviceWorkerSource).not.toContain('postMessage')
  })
})
