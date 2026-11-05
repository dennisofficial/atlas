import { describe, expect, it } from 'bun:test'

import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import {
  freshBrowser,
  navigated,
  NEW_TAB_URL,
  openTab,
  updateTab,
  type BrowserState,
} from '../../../data/preview-browser/browser-model'
import {
  EMPTY_REGISTRY,
  hidden,
  reloadedFrame,
  shown,
  slotKeyOf,
  unloaded,
} from '../frame-registry'
import { framesOf } from '../frames-of'
import { FRAME_Z, placementFrom, SHEET_FRAME_Z } from '../placement'
import { ETabPage, tabPageOf } from '../tab-page'

const URL_A = 'https://3000-abcdefghij.byatlas.dev/'
const URL_B = 'https://6006-abcdefghij.byatlas.dev/'

const element = (): HTMLElement => ({}) as HTMLElement

const browserOn = (args: { urls: string[]; now: number }): BrowserState => {
  let state = freshBrowser({ now: args.now })
  state = updateTab({
    state,
    id: 'tab-1',
    change: (tab) => navigated({ tab, url: args.urls[0] ?? NEW_TAB_URL }),
  })
  for (const url of args.urls.slice(1)) state = openTab({ state, url, now: args.now })
  return state
}

const port = (args: { url: string; status: EPreviewStatus }): PreviewPort => ({
  id: `service:${args.url}`,
  port: 3000,
  label: 'Web',
  url: args.url,
  status: args.status,
})

describe('frame registry', () => {
  it('opens a frame when its slot is shown and hides it without unloading', () => {
    const slot = { threadId: 't1', tabId: 'tab-1', element: element() }
    const visible = shown({ registry: EMPTY_REGISTRY, slot })
    expect(visible.visible).toBe(slot)
    expect(visible.opened.has(slotKeyOf(slot))).toBe(true)
    const away = hidden({ registry: visible, element: slot.element })
    expect(away.visible).toBeUndefined()
    expect(away.opened.has(slotKeyOf(slot))).toBe(true)
  })

  it('ignores hiding a slot that is no longer the visible one', () => {
    const first = shown({
      registry: EMPTY_REGISTRY,
      slot: { threadId: 't1', tabId: 'tab-1', element: element() },
    })
    const second = shown({
      registry: first,
      slot: { threadId: 't2', tabId: 'tab-1', element: element() },
    })
    expect(hidden({ registry: second, element: first.visible!.element })).toBe(second)
  })

  it('unloads and reloads by key', () => {
    const slot = { threadId: 't1', tabId: 'tab-1', element: element() }
    const opened = shown({ registry: EMPTY_REGISTRY, slot })
    expect(unloaded({ registry: opened, key: slotKeyOf(slot) }).opened.size).toBe(0)
    const once = reloadedFrame({ registry: opened, key: slotKeyOf(slot) })
    expect(reloadedFrame({ registry: once, key: slotKeyOf(slot) }).reloads[slotKeyOf(slot)]).toBe(2)
  })
})

describe('framesOf', () => {
  it('keeps frames for opened web tabs across threads, in a stable key order', () => {
    const states = {
      t2: browserOn({ urls: [URL_B], now: 2 }),
      t1: browserOn({ urls: [URL_A, URL_B], now: 1 }),
    }
    let registry = EMPTY_REGISTRY
    for (const [threadId, tabId] of [
      ['t2', 'tab-1'],
      ['t1', 'tab-1'],
      ['t1', 'tab-2'],
    ] as const) {
      registry = shown({ registry, slot: { threadId, tabId, element: element() } })
    }
    expect(framesOf({ states, registry }).map((frame) => frame.key)).toEqual([
      't1:tab-1',
      't1:tab-2',
      't2:tab-1',
    ])
  })

  it('never loads a tab that was not opened or is on the new-tab page', () => {
    const states = { t1: freshBrowser({ now: 1 }), t2: browserOn({ urls: [URL_A], now: 1 }) }
    const registry = shown({
      registry: EMPTY_REGISTRY,
      slot: { threadId: 't1', tabId: 'tab-1', element: element() },
    })
    expect(framesOf({ states, registry })).toEqual([])
  })

  it('drops the least recently used frames past the cap but keeps the visible tab', () => {
    const states = {
      old: browserOn({ urls: [URL_A], now: 1 }),
      recent: browserOn({ urls: [URL_B], now: 9 }),
    }
    let registry = shown({
      registry: EMPTY_REGISTRY,
      slot: { threadId: 'recent', tabId: 'tab-1', element: element() },
    })
    registry = shown({ registry, slot: { threadId: 'old', tabId: 'tab-1', element: element() } })
    expect(framesOf({ states, registry, cap: 1 }).map((frame) => frame.key)).toEqual(['old:tab-1'])
  })
})

describe('placementFrom', () => {
  it('scales the frame by the slot transform and lifts it above a sheet', () => {
    const placement = placementFrom({
      rect: { left: 10, top: 20, width: 187.5 },
      layout: { width: 375, height: 667 },
      inSheet: false,
    })
    expect(placement).toEqual({
      left: 10,
      top: 20,
      width: 375,
      height: 667,
      scale: 0.5,
      zIndex: FRAME_Z,
    })
    const inSheet = placementFrom({
      rect: { left: 0, top: 0, width: 0 },
      layout: { width: 0, height: 0 },
      inSheet: true,
    })
    expect(inSheet.scale).toBe(1)
    expect(inSheet.zIndex).toBe(SHEET_FRAME_Z)
  })
})

describe('tabPageOf', () => {
  const live = port({ url: 'https://3000-abcdefghij.byatlas.dev', status: EPreviewStatus.Live })
  const stopped = port({
    url: 'https://4000-abcdefghij.byatlas.dev',
    status: EPreviewStatus.Stopped,
  })

  it('maps a tab url to what the stage should show', () => {
    const ports = [live, stopped]
    expect(tabPageOf({ url: NEW_TAB_URL, ports, loaded: false }).kind).toBe(ETabPage.NewTab)
    expect(tabPageOf({ url: `${live.url}/x`, ports, loaded: false }).kind).toBe(ETabPage.Loading)
    expect(tabPageOf({ url: `${live.url}/x`, ports, loaded: true }).kind).toBe(ETabPage.Frame)
    expect(tabPageOf({ url: stopped.url, ports, loaded: true }).kind).toBe(ETabPage.Offline)
    expect(tabPageOf({ url: 'https://github.com/', ports, loaded: true }).kind).toBe(
      ETabPage.External,
    )
  })
})
