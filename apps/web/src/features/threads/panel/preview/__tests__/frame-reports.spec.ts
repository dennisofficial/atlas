import { describe, expect, it } from 'bun:test'

import {
  freshBrowser,
  navigated,
  updateTab,
  type BrowserState,
} from '../../../data/preview-browser/browser-model'
import { frameReportOf } from '../frame-messages'
import { reportedState } from '../report-navigation'

const ORIGIN = 'https://3000-abcdefghij.byatlas.dev'
const A = `${ORIGIN}/`
const B = `${ORIGIN}/b`

const location = (url: string) => ({ kind: 'atlas-preview:location', url, title: 'Page' })

describe('frameReportOf', () => {
  const mine = {}
  const other = {}
  const windows = new Map<string, unknown>([
    ['t1:tab-1', mine],
    ['t1:tab-2', other],
  ])

  it('routes a location to the frame whose window sent it', () => {
    expect(frameReportOf({ origin: ORIGIN, source: mine, data: location(B), windows })).toEqual({
      key: 't1:tab-1',
      url: B,
    })
    expect(frameReportOf({ origin: ORIGIN, source: other, data: location(B), windows })?.key).toBe(
      't1:tab-2',
    )
  })

  it('drops messages from unknown windows, foreign origins or with a mismatched url', () => {
    const drop = (args: { origin?: string; source?: unknown; data?: unknown }) =>
      frameReportOf({
        origin: args.origin ?? ORIGIN,
        source: args.source === undefined ? mine : args.source,
        data: args.data ?? location(B),
        windows,
      })
    expect(drop({ source: {} })).toBeNull()
    expect(drop({ source: null })).toBeNull()
    expect(drop({ origin: 'https://evil.com' })).toBeNull()
    expect(drop({ origin: 'http://localhost:3000' })).toBeNull()
    expect(drop({ data: location('https://6006-abcdefghij.byatlas.dev/') })).toBeNull()
    expect(drop({ data: location('javascript:alert(1)') })).toBeNull()
    expect(drop({ data: { kind: 'atlas-preview:command', command: 'back' } })).toBeNull()
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
    const tab = reportedState({ state, tabId: 'tab-1', url: B }).tabs[0]!
    expect(tab.history.at(-1)).toBe(B)
    expect(tab.load).toBe(state.tabs[0]!.load)
  })

  it('steps back when the frame reports the previous entry', () => {
    const forward = reportedState({ state: stateOn(), tabId: 'tab-1', url: B })
    const back = reportedState({ state: forward, tabId: 'tab-1', url: A }).tabs[0]!
    expect(back.index).toBe(back.history.indexOf(A))
    expect(back.history.at(-1)).toBe(B)
  })

  it('returns the same state for the current url, a non-web url or an unknown tab', () => {
    const state = stateOn()
    expect(reportedState({ state, tabId: 'tab-1', url: A })).toBe(state)
    expect(reportedState({ state, tabId: 'tab-1', url: 'about:blank' })).toBe(state)
    expect(reportedState({ state, tabId: 'nope', url: B })).toBe(state)
  })
})
