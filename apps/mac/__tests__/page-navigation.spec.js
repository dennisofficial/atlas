import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'bun:test'

import { EDeepLinkKind, EDeepLinkPlan, loadedPlanOf } from '../deep-links.js'
import { EClickPlan, clickPlanOf } from '../notification-clicks.js'
import { PAGE_NAVIGATE, createPageNavigation } from '../page-navigation.js'

const APP_URL = 'http://127.0.0.1:4242/'
const TARGET = `${APP_URL}sessions/s`

const setup = () => {
  const ipcMain = new EventEmitter()
  const webContents = new EventEmitter()
  const sent = []
  const loaded = []
  let destroyed = false
  webContents.send = (channel, request) => sent.push({ channel, request })
  const win = {
    webContents,
    isDestroyed: () => destroyed,
    loadURL: async (url) => loaded.push(url),
  }
  const navigation = createPageNavigation({ ipcMain, timeoutMs: 5 })
  return {
    win,
    navigation,
    sent,
    loaded,
    navigate: () => navigation.navigate({ win, path: '/sessions/s', url: TARGET }),
    acknowledge: ({ sender = webContents, requestId = sent.at(-1)?.request.requestId } = {}) =>
      ipcMain.emit(PAGE_NAVIGATE, { sender }, { requestId }),
    destroy: () => {
      destroyed = true
      webContents.emit('destroyed')
    },
  }
}

describe('page navigation plans', () => {
  const deepLink = { kind: EDeepLinkKind.Open, path: '/sessions/s' }

  test('reloads the known app instead of routing an error page or another origin', () => {
    for (const pageUrl of ['data:text/html,error', 'https://other.example/', '']) {
      expect(clickPlanOf({ sessionId: 's', pageUrl, appUrl: APP_URL })).toEqual({
        kind: EClickPlan.Navigate,
        url: TARGET,
      })
      expect(loadedPlanOf({ link: deepLink, pageUrl, appUrl: APP_URL })).toEqual({
        kind: EDeepLinkPlan.Navigate,
        url: TARGET,
      })
    }
  })

  test('defers notification navigation until an in-flight page load finishes', () => {
    expect(
      clickPlanOf({ sessionId: 's', pageUrl: APP_URL, appUrl: APP_URL, loading: true }),
    ).toEqual({ kind: EClickPlan.Defer })
  })

  test('keeps the query and hash in in-page navigation', () => {
    expect(
      loadedPlanOf({
        link: { kind: EDeepLinkKind.Open, path: '/settings?tab=accounts#provider' },
        pageUrl: APP_URL,
        appUrl: APP_URL,
      }),
    ).toEqual({
      kind: EDeepLinkPlan.NavigateInPage,
      path: '/settings?tab=accounts#provider',
      url: `${APP_URL}settings?tab=accounts#provider`,
    })
  })
})

describe('createPageNavigation', () => {
  test('keeps the renderer heap when the app acknowledges its navigation', async () => {
    const state = setup()
    const pending = state.navigate()
    expect(state.sent).toEqual([
      { channel: PAGE_NAVIGATE, request: { requestId: 1, path: '/sessions/s' } },
    ])
    state.acknowledge()
    await pending
    expect(state.loaded).toEqual([])
    expect(state.win.webContents.listenerCount('destroyed')).toBe(0)
  })

  test('loads the target if the renderer never acknowledges', async () => {
    const state = setup()
    await state.navigate()
    expect(state.loaded).toEqual([TARGET])
    expect(state.win.webContents.listenerCount('destroyed')).toBe(0)
  })

  test('ignores acknowledgements from another page or request', async () => {
    const state = setup()
    const pending = state.navigate()
    state.acknowledge({ sender: new EventEmitter() })
    state.acknowledge({ requestId: 99 })
    await pending
    expect(state.loaded).toEqual([TARGET])
  })

  test('falls back when IPC cannot send to the renderer', async () => {
    const state = setup()
    state.win.webContents.send = () => {
      throw new Error('renderer unavailable')
    }
    await state.navigate()
    expect(state.loaded).toEqual([TARGET])
  })

  test('never reloads a destroyed window', async () => {
    const state = setup()
    const pending = state.navigate()
    state.destroy()
    await pending
    await state.navigate()
    expect(state.loaded).toEqual([])
    expect(state.win.webContents.listenerCount('destroyed')).toBe(0)
  })

  test('a newer request replaces the older fallback', async () => {
    const state = setup()
    const first = state.navigate()
    const second = state.navigate()
    state.acknowledge()
    await Promise.all([first, second])
    expect(state.loaded).toEqual([])
  })

  test('late acknowledgements after a timeout are harmless', async () => {
    const state = setup()
    await state.navigate()
    expect(() => state.acknowledge()).not.toThrow()
    expect(state.loaded).toEqual([TARGET])
  })

  test('remembers the actual app URL through an error page', async () => {
    const state = setup()
    expect(state.navigation.urlOf(state.win)).toBeUndefined()
    await state.navigation.load({ win: state.win, url: APP_URL })
    await state.win.loadURL('data:text/html,error')
    expect(state.navigation.urlOf(state.win)).toBe(APP_URL)
  })

  test('restores the old app URL after an update fails to load', async () => {
    const state = setup()
    await state.navigation.load({ win: state.win, url: APP_URL })
    state.win.loadURL = async () => {
      throw new Error('update unavailable')
    }
    await expect(
      state.navigation.load({ win: state.win, url: 'http://127.0.0.1:5000/' }),
    ).rejects.toThrow('update unavailable')
    expect(state.navigation.urlOf(state.win)).toBe(APP_URL)
  })
})
