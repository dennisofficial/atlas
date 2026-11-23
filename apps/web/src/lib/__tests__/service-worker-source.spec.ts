import { describe, expect, it } from 'bun:test'

import {
  OPEN_SESSION_MESSAGE,
  PUSH_MESSAGE_CLEAR,
  PUSH_MESSAGE_NOTIFICATION,
  SERVICE_WORKER_PATH,
  SESSION_QUERY_PARAM,
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
    expect(serviceWorkerSource).toContain(
      'data: { sessionId: notification.sessionId, seq: notification.seq }',
    )
  })

  it('closes the notifications of a session by tag', () => {
    expect(serviceWorkerSource).toContain('self.registration.getNotifications({ tag: sessionId })')
    expect(serviceWorkerSource).toContain('notification.close()')
  })

  it('opens the session in an existing window before a new one', () => {
    expect(serviceWorkerSource).toContain(
      `existing.postMessage({ type: '${OPEN_SESSION_MESSAGE}', sessionId })`,
    )
    expect(serviceWorkerSource).toContain(`'/?${SESSION_QUERY_PARAM}='`)
    expect(serviceWorkerSource).toContain('self.clients.openWindow')
  })
})
