import { describe, expect, mock, test } from 'bun:test'

const exposed = {}
const sent = []
const acknowledgements = []
const handlers = new Map()
let state = false

mock.module('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key, value) => {
      exposed[key] = value
    },
  },
  ipcRenderer: {
    on: (channel, handler) => {
      handlers.set(channel, handler)
    },
    send: (channel, payload) => acknowledgements.push([channel, payload]),
    sendSync: (channel) => {
      sent.push(channel)
      return state
    },
  },
}))

await import('../preload.cjs')

const emit = (channel, payload) => {
  handlers.get(channel)({}, payload)
}

const listen = (name) => {
  const seen = []
  const listener = (report) => seen.push(report)
  exposed.atlasDesktop[name](listener)
  return { seen, listener }
}

describe('the atlasDesktop bridge', () => {
  test('acknowledges navigation only when an app listener accepts it', () => {
    const request = { requestId: 1, path: '/sessions/s' }
    emit('atlas-desktop:navigate', request)
    expect(acknowledgements).toEqual([])
    const seen = []
    const listener = (path) => {
      seen.push(path)
      return true
    }
    exposed.atlasDesktop.onNavigate(listener)
    emit('atlas-desktop:navigate', request)
    expect(seen).toEqual(['/sessions/s'])
    expect(acknowledgements).toEqual([['atlas-desktop:navigate', { requestId: 1 }]])
    exposed.atlasDesktop.offNavigate(listener)
    emit('atlas-desktop:navigate', { ...request, requestId: 2 })
    expect(acknowledgements).toHaveLength(1)
  })

  test('does not acknowledge a rejected or failed route', () => {
    acknowledgements.length = 0
    const reject = () => false
    const fail = () => {
      throw new Error('router unavailable')
    }
    exposed.atlasDesktop.onNavigate(reject)
    exposed.atlasDesktop.onNavigate(fail)
    emit('atlas-desktop:navigate', { requestId: 3, path: '/settings' })
    expect(acknowledgements).toEqual([])
    exposed.atlasDesktop.offNavigate(reject)
    exposed.atlasDesktop.offNavigate(fail)
  })

  test('reads full screen from the main process', () => {
    state = false
    expect(exposed.atlasDesktop.fullScreen()).toBe(false)
    state = true
    expect(exposed.atlasDesktop.fullScreen()).toBe(true)
    expect(sent).toEqual(['atlas-desktop:is-fullscreen', 'atlas-desktop:is-fullscreen'])
  })

  test('forwards every window transition to the listeners it was given, once each', () => {
    const seen = []
    const listener = (fullScreen) => seen.push(fullScreen)
    exposed.atlasDesktop.onFullScreenChange(listener)
    emit('atlas-desktop:fullscreen', true)
    expect(seen).toEqual([true])
    emit('atlas-desktop:fullscreen', false)
    expect(seen).toEqual([true, false])
    exposed.atlasDesktop.offFullScreenChange(listener)
    emit('atlas-desktop:fullscreen', true)
    expect(seen).toEqual([true, false])
  })

  test('forwards every pane navigation to the listeners it was given, once each', () => {
    const { seen, listener } = listen('onPaneNavigated')
    const report = { id: 'pane:thread-1:tab-1', url: 'https://example.com/a' }
    emit('atlas-desktop:pane-navigated', report)
    expect(seen).toEqual([report])
    exposed.atlasDesktop.offPaneNavigated(listener)
    emit('atlas-desktop:pane-navigated', report)
    expect(seen).toEqual([report])
  })

  test('forwards pane titles on their own channel', () => {
    const { seen } = listen('onPaneTitled')
    const report = { id: 'pane:thread-1:tab-1', title: 'Inbox' }
    emit('atlas-desktop:pane-titled', report)
    expect(seen).toEqual([report])
  })
})
