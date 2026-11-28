import { describe, expect, it } from 'bun:test'

import {
  EClickPlan,
  REFRESH_GAPS_MS,
  clickPlanOf,
  createClickWatcher,
  createSessionOpener,
  sessionIdOfDelivered,
} from '../notification-clicks.js'

const APP_URL = 'http://127.0.0.1:4242/'
const navigation = {
  urlOf: () => APP_URL,
  navigate: ({ win, path }) => win.calls.push(`navigate ${path}`),
}

const deliveredOf = ({ id, groupId }) => {
  const listeners = new Map()
  return {
    id,
    groupId,
    closed: false,
    on(name, listener) {
      listeners.set(name, listener)
    },
    close() {
      this.closed = true
    },
    click: () => listeners.get('click')?.(),
    listens: (name) => listeners.has(name),
  }
}

const centerOf = (batches) => {
  let call = 0
  return {
    getHistory: async () => {
      const batch = batches[Math.min(call, batches.length - 1)] ?? []
      call += 1
      return batch
    },
  }
}

const emitterOf = () => {
  const listeners = new Map()
  return {
    on: (name, listener) => listeners.set(name, listener),
    emit: (name, ...args) => listeners.get(name)?.(...args),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('sessionIdOfDelivered', () => {
  it('reads the session from the thread id of a delivered Atlas alert', () => {
    expect(sessionIdOfDelivered({ id: 'n-1', groupId: 'session-1' })).toBe('session-1')
  })

  it('opens nothing for an alert without a thread id', () => {
    expect(sessionIdOfDelivered({ id: 'n-1', groupId: '' })).toBeUndefined()
    expect(sessionIdOfDelivered({ id: 'n-1' })).toBeUndefined()
    expect(sessionIdOfDelivered(undefined)).toBeUndefined()
  })
})

describe('clickPlanOf', () => {
  it('moves a loaded page to the session on the same origin', () => {
    expect(
      clickPlanOf({ appUrl: APP_URL, sessionId: 'session/1', pageUrl: 'http://127.0.0.1:4242/' }),
    ).toEqual({
      kind: EClickPlan.NavigateInPage,
      path: '/sessions/session%2F1',
      url: 'http://127.0.0.1:4242/sessions/session%2F1',
    })
  })

  it('moves a page that shows another session', () => {
    expect(
      clickPlanOf({
        appUrl: APP_URL,
        sessionId: 'session-2',
        pageUrl: 'http://127.0.0.1:4242/sessions/session-1',
      }),
    ).toEqual({
      kind: EClickPlan.NavigateInPage,
      path: '/sessions/session-2',
      url: 'http://127.0.0.1:4242/sessions/session-2',
    })
  })

  it('only focuses a page that already shows the session', () => {
    expect(
      clickPlanOf({
        appUrl: APP_URL,
        sessionId: 'session-1',
        pageUrl: 'http://127.0.0.1:4242/sessions/session-1',
      }),
    ).toEqual({ kind: EClickPlan.Focus })
  })

  it('waits for the interface when the app address is unknown', () => {
    expect(clickPlanOf({ sessionId: 'session-1', pageUrl: '' })).toEqual({ kind: EClickPlan.Defer })
    expect(
      clickPlanOf({ sessionId: 'session-1', pageUrl: 'data:text/html;charset=utf-8,x' }),
    ).toEqual({ kind: EClickPlan.Defer })
  })
})

const windowOf = ({ pageUrl, minimized = false }) => {
  const calls = []
  const loads = new Map()
  const win = {
    calls,
    isDestroyed: () => false,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    loadURL: async (url) => calls.push(`load ${url}`),
    webContents: {
      isLoading: () => pageUrl === '',
      getURL: () => pageUrl,
      once: (name, listener) => loads.set(name, listener),
    },
    finishLoad: (url) => {
      pageUrl = url
      loads.get('did-finish-load')?.()
    },
  }
  return win
}

describe('createSessionOpener', () => {
  const appOf = (calls) => ({ show: () => calls.push('app.show') })

  it('shows, restores and focuses the window, then opens the session', () => {
    const win = windowOf({ pageUrl: 'http://127.0.0.1:4242/', minimized: true })
    const open = createSessionOpener({
      navigation,
      app: appOf(win.calls),
      windowNow: () => win,
      createWindow: async () => undefined,
    })

    open('session-1')

    expect(win.calls).toEqual([
      'app.show',
      'restore',
      'show',
      'focus',
      'navigate /sessions/session-1',
    ])
  })

  it('opens a new window on the session when every window is closed', () => {
    const created = []
    const open = createSessionOpener({
      navigation,
      app: appOf([]),
      windowNow: () => undefined,
      createWindow: async (options) => created.push(options),
    })

    open('session-1')

    expect(created).toEqual([{ sessionId: 'session-1' }])
  })

  it('opens the session once a loading window finishes its first page', () => {
    const win = windowOf({ pageUrl: '' })
    const open = createSessionOpener({
      navigation,
      app: appOf(win.calls),
      windowNow: () => win,
      createWindow: async () => undefined,
    })

    open('session-1')
    win.finishLoad('http://127.0.0.1:4242/')

    expect(win.calls.at(-1)).toBe('navigate /sessions/session-1')
  })
})

describe('createClickWatcher', () => {
  it('opens the session of a delivered alert the user clicks', async () => {
    const alert = deliveredOf({ id: 'n-1', groupId: 'session-1' })
    const opened = []
    const watcher = createClickWatcher({
      notifications: centerOf([[alert]]),
      onClick: (sessionId) => opened.push(sessionId),
    })

    await watcher.refresh()
    alert.click()

    expect(opened).toEqual(['session-1'])
    expect(watcher.watchedCount()).toBe(0)
  })

  it('keeps one handle per alert and releases the copy a later read returns', async () => {
    const first = deliveredOf({ id: 'n-1', groupId: 'session-1' })
    const copy = deliveredOf({ id: 'n-1', groupId: 'session-1' })
    const watcher = createClickWatcher({
      notifications: centerOf([[first], [copy]]),
      onClick: () => {},
    })

    await watcher.refresh()
    await watcher.refresh()

    expect(first.closed).toBe(false)
    expect(copy.closed).toBe(true)
    expect(watcher.watchedCount()).toBe(1)
  })

  it('releases alerts that left Notification Center', async () => {
    const alert = deliveredOf({ id: 'n-1', groupId: 'session-1' })
    const watcher = createClickWatcher({
      notifications: centerOf([[alert], []]),
      onClick: () => {},
    })

    await watcher.refresh()
    await watcher.refresh()

    expect(alert.closed).toBe(true)
    expect(watcher.watchedCount()).toBe(0)
  })

  it('releases an alert with no session at once', async () => {
    const alert = deliveredOf({ id: 'n-1' })
    const watcher = createClickWatcher({ notifications: centerOf([[alert]]), onClick: () => {} })

    await watcher.refresh()

    expect(alert.closed).toBe(true)
    expect(alert.listens('click')).toBe(false)
  })

  it('reads Notification Center again after each push until the alert is there', async () => {
    const alert = deliveredOf({ id: 'n-1', groupId: 'session-1' })
    const gaps = []
    const watcher = createClickWatcher({
      notifications: centerOf([[], [], [alert]]),
      onClick: () => {},
      wait: async (ms) => gaps.push(ms),
    })
    const pushes = emitterOf()

    await watcher.start({ pushes, app: emitterOf() })
    pushes.emit('received-apns-notification', {}, { sessionId: 'session-1', seq: 1 })
    for (const _gap of REFRESH_GAPS_MS) await settle()
    await settle()

    expect(gaps).toEqual(REFRESH_GAPS_MS.filter((gap) => gap > 0))
    expect(watcher.watchedCount()).toBe(1)
  })

  it('reads Notification Center when the app goes to the background', async () => {
    const alert = deliveredOf({ id: 'n-1', groupId: 'session-1' })
    const watcher = createClickWatcher({
      notifications: centerOf([[], [alert]]),
      onClick: () => {},
    })
    const app = emitterOf()

    await watcher.start({ pushes: emitterOf(), app })
    app.emit('did-resign-active')
    await settle()

    expect(watcher.watchedCount()).toBe(1)
  })

  it('logs a failed read and keeps watching', async () => {
    const lines = []
    let fail = true
    const alert = deliveredOf({ id: 'n-1', groupId: 'session-1' })
    const watcher = createClickWatcher({
      notifications: {
        getHistory: async () => {
          if (!fail) return [alert]
          fail = false
          throw new Error('unsigned build')
        },
      },
      onClick: () => {},
      log: (line) => lines.push(line),
    })

    await watcher.refresh()
    await watcher.refresh()

    expect(lines).toHaveLength(1)
    expect(watcher.watchedCount()).toBe(1)
  })
})
