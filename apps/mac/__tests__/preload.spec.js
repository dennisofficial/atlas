import { describe, expect, mock, test } from 'bun:test'

const exposed = {}
const sent = []
let state = false
let onState = () => undefined

mock.module('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key, value) => {
      exposed[key] = value
    },
  },
  ipcRenderer: {
    on: (channel, handler) => {
      onState = handler
    },
    sendSync: (channel) => {
      sent.push(channel)
      return state
    },
  },
}))

await import('../preload.cjs')

describe('the atlasDesktop bridge', () => {
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
    onState({}, true)
    expect(seen).toEqual([true])
    onState({}, false)
    expect(seen).toEqual([true, false])
    exposed.atlasDesktop.offFullScreenChange(listener)
    onState({}, true)
    expect(seen).toEqual([true, false])
  })
})
