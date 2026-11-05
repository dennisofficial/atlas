import { describe, expect, it } from 'bun:test'

import {
  EViewportKind,
  MAX_HISTORY,
  NEW_TAB_URL,
  activateTab,
  activeTabOf,
  canGoBack,
  canGoForward,
  closeTab,
  currentUrlOf,
  freshBrowser,
  navigated,
  openTab,
  reconciled,
  reloaded,
  steppedBack,
  steppedForward,
  titled,
  updateTab,
  withViewport,
} from '../browser-model'

const A = 'https://3000-abcdefghij.byatlas.dev/'
const B = 'https://3000-abcdefghij.byatlas.dev/b'
const C = 'https://3000-abcdefghij.byatlas.dev/c'

describe('browser-model', () => {
  it('starts fresh with one active new tab', () => {
    const state = freshBrowser()
    expect(state.tabs).toHaveLength(1)
    expect(state.activeId).toBe('tab-1')
    expect(state.nextId).toBe(2)
    expect(state.tabs[0]).toMatchObject({ history: [NEW_TAB_URL], index: 0 })
    expect(state.tabs[0]?.viewport).toEqual({ kind: EViewportKind.Full })
  })

  it('opens a tab to the right of the active one and activates it', () => {
    let state = freshBrowser()
    state = openTab({ state, url: A })
    state = openTab({ state, url: B })
    state = activateTab({ state, id: 'tab-1' })
    state = openTab({ state })
    expect(state.tabs.map((tab) => tab.id)).toEqual(['tab-1', 'tab-4', 'tab-2', 'tab-3'])
    expect(state.activeId).toBe('tab-4')
    expect(currentUrlOf(activeTabOf(state)!)).toBe(NEW_TAB_URL)
  })

  it('appends when nothing is active', () => {
    const state = openTab({
      state: { tabs: [], activeId: undefined, nextId: 7 },
      url: A,
    })
    expect(state.tabs.map((tab) => tab.id)).toEqual(['tab-7'])
  })

  it('closes the active tab and activates the right neighbour, else the left', () => {
    let state = freshBrowser()
    state = openTab({ state, url: A })
    state = openTab({ state, url: B })
    state = activateTab({ state, id: 'tab-2' })
    expect(closeTab({ state, id: 'tab-2' }).activeId).toBe('tab-3')
    expect(closeTab({ state: activateTab({ state, id: 'tab-3' }), id: 'tab-3' }).activeId).toBe(
      'tab-2',
    )
  })

  it('keeps the active tab when closing another and ignores unknown ids', () => {
    let state = freshBrowser()
    state = openTab({ state, url: A })
    const closed = closeTab({ state, id: 'tab-1' })
    expect(closed.activeId).toBe('tab-2')
    expect(closed.tabs).toHaveLength(1)
    expect(closeTab({ state, id: 'nope' })).toBe(state)
  })

  it('closing the last tab leaves no active tab', () => {
    const state = closeTab({ state: freshBrowser(), id: 'tab-1' })
    expect(state.tabs).toEqual([])
    expect(state.activeId).toBeUndefined()
  })

  it('activates a tab; the active or an unknown id is a no-op', () => {
    let state = freshBrowser()
    state = openTab({ state })
    const next = activateTab({ state, id: 'tab-1' })
    expect(next.activeId).toBe('tab-1')
    expect(activateTab({ state: next, id: 'tab-1' })).toBe(next)
    expect(activateTab({ state, id: 'nope' })).toBe(state)
  })

  it('keeps the page title until the tab loads another page', () => {
    let tab = navigated({ tab: freshBrowser().tabs[0]!, url: A })
    tab = titled({ tab, title: '  Checkout  ' })
    expect(tab.title).toBe('Checkout')
    expect(titled({ tab, title: 'Checkout' })).toBe(tab)
    expect(titled({ tab, title: ' ' }).title).toBeUndefined()
    expect(reloaded(tab).title).toBe('Checkout')
    expect(navigated({ tab, url: B }).title).toBeUndefined()
    expect(steppedBack(tab).title).toBeUndefined()
  })

  it('updates only the named tab', () => {
    let state = freshBrowser()
    state = openTab({ state })
    const next = updateTab({
      state,
      id: 'tab-1',
      change: (tab) => navigated({ tab, url: A }),
    })
    expect(currentUrlOf(next.tabs[0]!)).toBe(A)
    expect(currentUrlOf(next.tabs[1]!)).toBe(NEW_TAB_URL)
  })

  it('navigates, truncating forward history, and ignores the same url', () => {
    let tab = freshBrowser().tabs[0]!
    tab = navigated({ tab, url: A })
    tab = navigated({ tab, url: B })
    expect(navigated({ tab, url: B })).toBe(tab)
    tab = steppedBack(tab)
    tab = navigated({ tab, url: C })
    expect(tab.history).toEqual([NEW_TAB_URL, A, C])
    expect(tab.index).toBe(2)
    expect(canGoForward(tab)).toBe(false)
  })

  it('reloads the current entry by bumping the load seq only', () => {
    const tab = navigated({ tab: freshBrowser().tabs[0]!, url: A })
    const next = reloaded(tab)
    expect(next.load).toEqual({ url: A, seq: tab.load.seq + 1 })
    expect(next.history).toBe(tab.history)
    expect(next.index).toBe(tab.index)
  })

  it('steps back and forward within bounds', () => {
    let tab = freshBrowser().tabs[0]!
    expect(steppedBack(tab)).toBe(tab)
    expect(steppedForward(tab)).toBe(tab)
    tab = navigated({ tab, url: A })
    expect(canGoBack(tab)).toBe(true)
    tab = steppedBack(tab)
    expect(currentUrlOf(tab)).toBe(NEW_TAB_URL)
    expect(canGoBack(tab)).toBe(false)
    expect(canGoForward(tab)).toBe(true)
    expect(currentUrlOf(steppedForward(tab))).toBe(A)
  })

  it('caps history at the most recent entries', () => {
    let tab = freshBrowser().tabs[0]!
    for (let step = 0; step < MAX_HISTORY + 10; step += 1) {
      tab = navigated({ tab, url: `https://x.test/${step}` })
    }
    expect(tab.history).toHaveLength(MAX_HISTORY)
    expect(tab.index).toBe(MAX_HISTORY - 1)
    expect(currentUrlOf(tab)).toBe(`https://x.test/${MAX_HISTORY + 9}`)
  })

  it('sets the viewport', () => {
    const tab = freshBrowser().tabs[0]!
    const viewport = { kind: EViewportKind.Fixed, width: 390, height: 844 } as const
    expect(withViewport({ tab, viewport }).viewport).toEqual(viewport)
  })

  it('bumps load when atlas navigates or steps, never when the page reports', () => {
    let tab = freshBrowser().tabs[0]!
    expect(tab.load).toEqual({ url: NEW_TAB_URL, seq: 0 })
    tab = navigated({ tab, url: A })
    expect(tab.load).toEqual({ url: A, seq: 1 })
    tab = navigated({ tab, url: B })
    tab = steppedBack(tab)
    expect(tab.load).toEqual({ url: A, seq: 3 })
    tab = steppedForward(tab)
    expect(tab.load).toEqual({ url: B, seq: 4 })
    expect(navigated({ tab, url: B }).load.seq).toBe(4)
  })
})

describe('reconciled', () => {
  const at = (urls: string[], index: number) => {
    let tab = freshBrowser().tabs[0]!
    for (const url of urls) tab = navigated({ tab, url })
    for (let step = urls.length - index; step > 0; step -= 1) tab = steppedBack(tab)
    return tab
  }

  it('ignores the url the tab is already on, even if only normalised differently', () => {
    const tab = at([A, B], 2)
    expect(reconciled({ tab, url: B })).toBe(tab)
    expect(reconciled({ tab, url: 'https://3000-abcdefghij.byatlas.dev/b#' })).toBe(tab)
  })

  it('steps back or forward when the url is the neighbouring entry', () => {
    const tab = at([A, B, C], 2)
    expect(reconciled({ tab, url: A }).index).toBe(1)
    expect(reconciled({ tab, url: C }).index).toBe(3)
  })

  it('pushes anything else and truncates forward history', () => {
    const tab = at([A, B, C], 1)
    const next = reconciled({ tab, url: 'https://x.test/' })
    expect(next.history).toEqual([NEW_TAB_URL, A, 'https://x.test/'])
    expect(next.index).toBe(2)
  })

  it('never touches load', () => {
    const tab = at([A, B, C], 2)
    for (const url of [A, C, 'https://x.test/']) {
      expect(reconciled({ tab, url }).load).toBe(tab.load)
    }
  })

  it('caps history like navigated does', () => {
    let tab = freshBrowser().tabs[0]!
    for (let step = 0; step < MAX_HISTORY + 5; step += 1) {
      tab = reconciled({ tab, url: `https://x.test/${step}` })
    }
    expect(tab.history).toHaveLength(MAX_HISTORY)
    expect(tab.index).toBe(MAX_HISTORY - 1)
  })
})
