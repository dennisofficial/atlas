import { describe, expect, it } from 'bun:test'

import { APNS_PUSH_PATH, APNS_TOKEN_PATH, createApnsBridge } from '../apns.js'

const replyOf = (body, ok = true) => ({ ok, json: async () => body })

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const recorderOf = ({ groups = [] } = {}) => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    return replyOf({ ok: true, groups })
  }
  return { calls, fetchFn }
}

const notificationsOf = (history = []) => {
  const removed = []
  return {
    removed,
    notifications: {
      getHistory: async () => history,
      removeGroup: (groupId) => removed.push(groupId),
    },
  }
}

const pushesOf = ({ token = 'device-token', fail = false } = {}) => {
  const listeners = []
  return {
    listeners,
    pushes: {
      on: (name, listener) => listeners.push({ name, listener }),
      registerForAPNSNotifications: async () => {
        if (fail) throw new Error('not signed')
        return token
      },
    },
  }
}

describe('createApnsBridge.start', () => {
  it('registers for APNs and sends the token once the host has a URL', async () => {
    const { calls, fetchFn } = recorderOf()
    const { notifications } = notificationsOf()
    const { pushes } = pushesOf()

    const bridge = createApnsBridge({ secret: 's3cret', fetchFn, notifications, pushes })
    bridge.attach('http://127.0.0.1:4242')
    await bridge.start()
    await settle()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`http://127.0.0.1:4242${APNS_TOKEN_PATH}`)
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.init.headers.cookie).toBe('atlas_desktop=s3cret')
    expect(JSON.parse(calls[0]?.init.body)).toEqual({ token: 'device-token' })
  })

  it('keeps the token until a host attaches after the registration', async () => {
    const { calls, fetchFn } = recorderOf()
    const { notifications } = notificationsOf()
    const { pushes } = pushesOf()

    const bridge = createApnsBridge({ secret: 's3cret', fetchFn, notifications, pushes })
    await bridge.start()
    expect(calls).toEqual([])

    bridge.attach('http://127.0.0.1:4343')
    await settle()

    expect(calls.map((call) => call.url)).toEqual([`http://127.0.0.1:4343${APNS_TOKEN_PATH}`])
  })

  it('reports a refused registration and sends nothing', async () => {
    const { calls, fetchFn } = recorderOf()
    const { notifications } = notificationsOf()
    const { pushes } = pushesOf({ fail: true })
    const lines = []

    const bridge = createApnsBridge({
      secret: 's3cret',
      fetchFn,
      notifications,
      pushes,
      log: (line) => lines.push(line),
    })
    bridge.attach('http://127.0.0.1:4444')
    await bridge.start()

    expect(lines).toHaveLength(1)
    expect(calls).toEqual([])
  })
})

describe('createApnsBridge.received', () => {
  it('removes only the group of the session a clear push names', async () => {
    const { calls, fetchFn } = recorderOf({ groups: ['session-1'] })
    const { removed, notifications } = notificationsOf([
      { groupId: 'session-1' },
      { groupId: 'session-2' },
    ])
    const { pushes } = pushesOf()

    const bridge = createApnsBridge({ secret: 's3cret', fetchFn, notifications, pushes })
    bridge.attach('http://127.0.0.1:4545')
    await bridge.received({ clearSessionId: 'session-1' })

    expect(calls[0]?.url).toBe(`http://127.0.0.1:4545${APNS_PUSH_PATH}`)
    expect(JSON.parse(calls[0]?.init.body)).toEqual({
      userInfo: { clearSessionId: 'session-1' },
      groupIds: ['session-1', 'session-2'],
    })
    expect(removed).toEqual(['session-1'])
  })

  it('answers the host listener when a push arrives', async () => {
    const { fetchFn } = recorderOf({ groups: ['session-1'] })
    const { removed, notifications } = notificationsOf([{ groupId: 'session-1' }])
    const { listeners, pushes } = pushesOf()

    const bridge = createApnsBridge({ secret: 's3cret', fetchFn, notifications, pushes })
    bridge.attach('http://127.0.0.1:4646')
    await bridge.start()
    const listener = listeners.find((entry) => entry.name === 'received-apns-notification')
    listener?.listener({}, { clearSessionId: 'session-1' })
    await settle()

    expect(removed).toEqual(['session-1'])
  })

  it('survives a host that refuses the push and a history that throws', async () => {
    const fetchFn = async () => replyOf({}, false)
    const { removed } = notificationsOf()
    const notifications = {
      getHistory: async () => {
        throw new Error('unsigned build')
      },
      removeGroup: (groupId) => removed.push(groupId),
    }
    const { pushes } = pushesOf()

    const bridge = createApnsBridge({ secret: 's3cret', fetchFn, notifications, pushes })
    bridge.attach('http://127.0.0.1:4747')
    await bridge.received({ clearSessionId: 'session-1' })

    expect(removed).toEqual([])
  })
})
