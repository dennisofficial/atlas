import { describe, expect, it } from 'bun:test'

import {
  NEW_TAB_URL,
  activeTabOf,
  currentUrlOf,
  freshBrowser,
  navigated,
  updateTab,
} from '../browser-model'
import { openUrlIn } from '../open-in-browser'

const URL_A = 'https://3000-abcdefghij.byatlas.dev/'

describe('openUrlIn', () => {
  it('navigates the active tab when it is on the new-tab page', () => {
    const state = openUrlIn({ state: freshBrowser({ now: 1 }), url: URL_A, now: 5 })
    expect(state.tabs).toHaveLength(1)
    const tab = activeTabOf(state)!
    expect(currentUrlOf(tab)).toBe(URL_A)
    expect(tab.history).toEqual([NEW_TAB_URL, URL_A])
    expect(tab.lastUsedAt).toBe(5)
  })

  it('opens a new tab when the active tab already shows a page', () => {
    const first = openUrlIn({ state: freshBrowser({ now: 1 }), url: URL_A, now: 2 })
    const state = openUrlIn({ state: first, url: `${URL_A}x`, now: 3 })
    expect(state.tabs).toHaveLength(2)
    expect(currentUrlOf(activeTabOf(state)!)).toBe(`${URL_A}x`)
  })

  it('opens a new tab when there is no active tab', () => {
    const state = openUrlIn({
      state: { tabs: [], activeId: undefined, nextId: 1 },
      url: URL_A,
      now: 1,
    })
    expect(state.tabs).toHaveLength(1)
  })

  it('opens a new tab when only a non-active tab is blank', () => {
    let state = freshBrowser({ now: 1 })
    state = updateTab({ state, id: 'tab-1', change: (tab) => navigated({ tab, url: URL_A }) })
    const next = openUrlIn({ state, url: `${URL_A}y`, now: 2 })
    expect(next.tabs).toHaveLength(2)
  })
})
