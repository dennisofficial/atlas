import { describe, expect, it } from 'bun:test'

import {
  freshBrowser,
  navigated,
  updateTab,
  type BrowserState,
} from '../../../data/preview-browser/browser-model'
import { bindWebview, urlOfEvent } from '../native/bind-webview'
import { createFrameDriver } from '../native/frame-driver'
import { partitionFor } from '../native/native-frame'
import { nativeOf, registerNative } from '../native/native-controls'
import { OVERLAY_MASKS } from '../native/masks'
import { ENativeEvent, type NativeEvent, type NativeWebview } from '../native/webview-handle'
import { reportedState } from '../report-navigation'

const A = 'http://localhost:3000/'
const B = 'http://localhost:3000/b'

class FakeWebview implements NativeWebview {
  listeners = new Map<string, Array<(event: NativeEvent) => void>>()
  calls: string[] = []
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
  canGoBack = async () => false
  canGoForward = async () => false
  toggleHidden = (hidden: boolean) => void this.calls.push(`hidden ${hidden}`)
  addMaskSelector = (selector: string) => void this.calls.push(`mask+ ${selector}`)
  removeMaskSelector = (selector: string) => void this.calls.push(`mask- ${selector}`)
  syncDimensions = (force?: boolean) => void this.calls.push(`sync ${force === true}`)
  fire = (name: ENativeEvent, detail: unknown) => {
    for (const listener of this.listeners.get(name) ?? []) listener({ detail })
  }
}

describe('urlOfEvent', () => {
  it('reads the url from a plain string detail only', () => {
    expect(urlOfEvent({ detail: A })).toBe(A)
    expect(urlOfEvent({ detail: '' })).toBeNull()
    expect(urlOfEvent({ detail: { url: A } })).toBeNull()
    expect(urlOfEvent({})).toBeNull()
  })
})

describe('bindWebview', () => {
  it('reports navigations and dom-ready urls', () => {
    const webview = new FakeWebview()
    const urls: string[] = []
    let ready = 0
    bindWebview({
      webview,
      onNavigated: (url) => urls.push(url),
      onReady: () => (ready += 1),
    })
    webview.fire(ENativeEvent.DidNavigate, A)
    webview.fire(ENativeEvent.DidNavigateInPage, B)
    webview.fire(ENativeEvent.DomReady, B)
    expect(urls).toEqual([A, B, B])
    expect(ready).toBe(1)
  })

  it('ignores events without a url string but still reports ready', () => {
    const webview = new FakeWebview()
    const urls: string[] = []
    let ready = 0
    bindWebview({
      webview,
      onNavigated: (url) => urls.push(url),
      onReady: () => (ready += 1),
    })
    webview.fire(ENativeEvent.DidNavigate, undefined)
    expect(urls).toEqual([])
    expect(ready).toBe(0)
  })

  it('stops reporting after unbinding', () => {
    const webview = new FakeWebview()
    const urls: string[] = []
    const unbind = bindWebview({
      webview,
      onNavigated: (url) => urls.push(url),
      onReady: () => undefined,
    })
    unbind()
    webview.fire(ENativeEvent.DidNavigate, A)
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

  it('hides a visible tab while a dialog covers it and shows it again after', () => {
    const webview = new FakeWebview()
    const driver = createFrameDriver({ webview, seq: 0 })
    driver.apply({ url: A, seq: 0, visible: true })
    driver.setObscured(true)
    driver.setObscured(true)
    driver.setObscured(false)
    driver.apply({ url: A, seq: 0, visible: false })
    driver.setObscured(true)
    expect(webview.calls).toEqual(['hidden true', 'hidden false', 'hidden true'])
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

describe('the native tag configuration', () => {
  it('spells the one persistent profile per engine', () => {
    expect(partitionFor('cef')).toBe('persist:atlas-browser')
    expect(partitionFor('native')).toBe('persist:A7C4B1E2-9F3D-4C6A-8B2E-5D1F0A9C3E7B')
  })

  it('masks the popovers and clip strips', () => {
    expect(OVERLAY_MASKS).toContain('[data-preview-clip]')
    expect(OVERLAY_MASKS).toContain('[data-slot=dropdown-menu-content]')
    expect(OVERLAY_MASKS).not.toContain('[data-slot=dialog-content]')
  })
})

describe('native handle registry', () => {
  it('registers a handle until its own cleanup runs', () => {
    const webview = new FakeWebview()
    const driver = createFrameDriver({ webview, seq: 0 })
    const unregister = registerNative({ key: 't1:tab-1', handle: { webview, driver } })
    expect(nativeOf('t1:tab-1')?.webview).toBe(webview)
    const stale = registerNative({ key: 't1:tab-1', handle: { webview, driver } })
    unregister()
    expect(nativeOf('t1:tab-1')).toBeDefined()
    stale()
    expect(nativeOf('t1:tab-1')).toBeUndefined()
  })
})

describe('reportedState', () => {
  const stateOn = (): BrowserState =>
    updateTab({
      state: freshBrowser(),
      id: 'tab-1',
      change: (tab) => navigated({ tab, url: A }),
    })

  it('records a reported url in history without bumping load', () => {
    const state = stateOn()
    const next = reportedState({ state, tabId: 'tab-1', url: B, title: '' })
    const tab = next.tabs[0]!
    expect(tab.history.at(-1)).toBe(B)
    expect(tab.load).toBe(state.tabs[0]!.load)
  })

  it('returns the same state for the current url, a non-web url or an unknown tab', () => {
    const state = stateOn()
    expect(reportedState({ state, tabId: 'tab-1', url: A, title: '' })).toBe(state)
    expect(reportedState({ state, tabId: 'tab-1', url: 'about:blank', title: '' })).toBe(state)
    expect(reportedState({ state, tabId: 'nope', url: B, title: '' })).toBe(state)
  })
})
