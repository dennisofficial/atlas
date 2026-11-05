import { describe, expect, it } from 'bun:test'

import {
  EViewportKind,
  freshBrowser,
  navigated,
  updateTab,
  type BrowserState,
} from '../../../data/preview-browser/browser-model'
import { bindWebview, urlOfEvent } from '../native/bind-webview'
import { createFrameDriver } from '../native/frame-driver'
import { isInSheet, SHEET_MASK, syncSheetMask } from '../native/masks'
import { reportedState } from '../native/report-navigation'
import { ENativeEvent, type NativeEvent, type NativeWebview } from '../native/webview-handle'

const A = 'http://localhost:3000/'
const B = 'http://localhost:3000/b'

class FakeWebview implements NativeWebview {
  listeners = new Map<string, Array<(event: NativeEvent) => void>>()
  calls: string[] = []
  back = false
  forward = false
  on = (name: ENativeEvent, listener: (event: NativeEvent) => void) => {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }
  off = (name: ENativeEvent, listener: (event: NativeEvent) => void) => {
    this.listeners.set(
      name,
      (this.listeners.get(name) ?? []).filter((held) => held !== listener),
    )
  }
  loadURL = (url: string) => void this.calls.push(`load ${url}`)
  reload = () => void this.calls.push('reload')
  goBack = () => void this.calls.push('back')
  goForward = () => void this.calls.push('forward')
  canGoBack = async () => this.back
  canGoForward = async () => this.forward
  toggleHidden = (hidden: boolean) => void this.calls.push(`hidden ${hidden}`)
  addMaskSelector = (selector: string) => void this.calls.push(`mask+ ${selector}`)
  removeMaskSelector = (selector: string) => void this.calls.push(`mask- ${selector}`)
  syncDimensions = (force?: boolean) => void this.calls.push(`sync ${force === true}`)
  fire = (name: ENativeEvent, detail: unknown) => {
    for (const listener of this.listeners.get(name) ?? []) listener({ detail })
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('urlOfEvent', () => {
  it('reads the url from a plain string detail only', () => {
    expect(urlOfEvent({ detail: A })).toBe(A)
    expect(urlOfEvent({ detail: '' })).toBeNull()
    expect(urlOfEvent({ detail: { url: A } })).toBeNull()
    expect(urlOfEvent({})).toBeNull()
  })
})

describe('bindWebview', () => {
  it('reports navigations and refreshes back/forward after each', async () => {
    const webview = new FakeWebview()
    const urls: string[] = []
    const navs: Array<{ canGoBack: boolean; canGoForward: boolean }> = []
    let ready = 0
    bindWebview({
      webview,
      onNavigated: (url) => urls.push(url),
      onNavState: (state) => navs.push(state),
      onReady: () => (ready += 1),
    })
    webview.back = true
    webview.fire(ENativeEvent.DidNavigate, A)
    webview.fire(ENativeEvent.DidNavigateInPage, B)
    webview.fire(ENativeEvent.DomReady, B)
    await settle()
    expect(urls).toEqual([A, B, B])
    expect(ready).toBe(1)
    expect(navs.at(-1)).toEqual({ canGoBack: true, canGoForward: false })
  })

  it('ignores events without a url string but still refreshes nav state', async () => {
    const webview = new FakeWebview()
    const urls: string[] = []
    let navCount = 0
    bindWebview({
      webview,
      onNavigated: (url) => urls.push(url),
      onNavState: () => (navCount += 1),
      onReady: () => undefined,
    })
    webview.fire(ENativeEvent.DidNavigate, undefined)
    await settle()
    expect(urls).toEqual([])
    expect(navCount).toBe(1)
  })

  it('stops reporting after unbinding', async () => {
    const webview = new FakeWebview()
    const urls: string[] = []
    const unbind = bindWebview({
      webview,
      onNavigated: (url) => urls.push(url),
      onNavState: () => undefined,
      onReady: () => undefined,
    })
    unbind()
    webview.fire(ENativeEvent.DidNavigate, A)
    await settle()
    expect(urls).toEqual([])
  })
})

describe('createFrameDriver', () => {
  it('loads only when seq changes and toggles hidden only on change', () => {
    const webview = new FakeWebview()
    const driver = createFrameDriver({ webview, seq: 0 })
    driver.apply({ url: A, seq: 0, visible: true })
    driver.apply({ url: B, seq: 0, visible: true })
    expect(webview.calls).toEqual([])
    driver.apply({ url: B, seq: 1, visible: true })
    driver.apply({ url: B, seq: 1, visible: false })
    driver.apply({ url: B, seq: 1, visible: false })
    driver.apply({ url: B, seq: 1, visible: true })
    expect(webview.calls).toEqual([`load ${B}`, 'hidden true', 'hidden false'])
  })

  it('re-asserts hidden once the native view exists', () => {
    const webview = new FakeWebview()
    const driver = createFrameDriver({ webview, seq: 0 })
    driver.reassertVisibility()
    expect(webview.calls).toEqual([])
    driver.apply({ url: A, seq: 0, visible: false })
    driver.reassertVisibility()
    expect(webview.calls).toEqual(['hidden true', 'hidden true'])
  })
})

describe('sheet mask', () => {
  it('masks sheets unless the preview lives inside one', () => {
    const webview = new FakeWebview()
    syncSheetMask({ webview, inSheet: false })
    syncSheetMask({ webview, inSheet: true })
    expect(webview.calls).toEqual([`mask+ ${SHEET_MASK}`, `mask- ${SHEET_MASK}`])
    expect(isInSheet(undefined)).toBe(false)
    expect(isInSheet({ closest: () => ({}) } as unknown as Element)).toBe(true)
    expect(isInSheet({ closest: () => null } as unknown as Element)).toBe(false)
  })
})

describe('reportedState', () => {
  const stateOn = (): BrowserState =>
    updateTab({
      state: freshBrowser({ now: 1 }),
      id: 'tab-1',
      change: (tab) => navigated({ tab, url: A }),
    })

  it('records a reported url in history without bumping load', () => {
    const state = stateOn()
    const next = reportedState({ state, tabId: 'tab-1', url: B })
    const tab = next.tabs[0]!
    expect(tab.history.at(-1)).toBe(B)
    expect(tab.load).toBe(state.tabs[0]!.load)
  })

  it('returns the same state for the current url, a non-web url or an unknown tab', () => {
    const state = stateOn()
    expect(reportedState({ state, tabId: 'tab-1', url: A })).toBe(state)
    expect(reportedState({ state, tabId: 'tab-1', url: 'about:blank' })).toBe(state)
    expect(reportedState({ state, tabId: 'nope', url: B })).toBe(state)
    expect(state.tabs[0]?.viewport.kind).toBe(EViewportKind.Full)
  })
})
