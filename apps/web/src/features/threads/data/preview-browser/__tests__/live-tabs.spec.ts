import { describe, expect, it } from 'bun:test'

import type { BrowserState, BrowserTab } from '../browser-model'
import { EViewportKind } from '../browser-model'
import { liveKeyOf, liveTabIdsOf } from '../live-tabs'

const tabOf = (id: string, lastUsedAt: number): BrowserTab => ({
  id,
  history: ['atlas://new-tab'],
  index: 0,
  viewport: { kind: EViewportKind.Full },
  lastUsedAt,
})

const stateOf = (args: { tabs: BrowserTab[]; activeId?: string }): BrowserState => ({
  tabs: args.tabs,
  activeId: args.activeId,
  nextId: 100,
})

describe('liveTabIdsOf', () => {
  it('keeps the most recently used tabs across threads up to the cap', () => {
    const states = {
      t1: stateOf({ tabs: [tabOf('a', 10), tabOf('b', 40)] }),
      t2: stateOf({ tabs: [tabOf('c', 30), tabOf('d', 20)] }),
    }
    const live = liveTabIdsOf({ states, cap: 3 })
    expect([...live]).toEqual(['t1:b', 't2:c', 't2:d'])
  })

  it('always includes the visible thread active tab even when old', () => {
    const states = {
      t1: stateOf({ tabs: [tabOf('a', 1), tabOf('b', 2)], activeId: 'a' }),
      t2: stateOf({ tabs: [tabOf('c', 50), tabOf('d', 60)] }),
    }
    const live = liveTabIdsOf({ states, visibleThreadId: 't1', cap: 2 })
    expect(live.has(liveKeyOf({ threadId: 't1', tabId: 'a' }))).toBe(true)
    expect(live.size).toBe(2)
    expect(live.has('t2:d')).toBe(true)
  })

  it('defaults the cap to eight', () => {
    const tabs = Array.from({ length: 12 }, (_, at) => tabOf(`t${at}`, at))
    const live = liveTabIdsOf({ states: { x: stateOf({ tabs }) } })
    expect(live.size).toBe(8)
    expect(live.has('x:t11')).toBe(true)
    expect(live.has('x:t3')).toBe(false)
  })

  it('returns everything when under the cap and handles missing visible thread', () => {
    const states = { t1: stateOf({ tabs: [tabOf('a', 1)] }) }
    expect([...liveTabIdsOf({ states, visibleThreadId: 'missing' })]).toEqual(['t1:a'])
    expect(liveTabIdsOf({ states: {} }).size).toBe(0)
  })

  it('breaks ties deterministically by key', () => {
    const states = { t1: stateOf({ tabs: [tabOf('b', 5), tabOf('a', 5)] }) }
    expect([...liveTabIdsOf({ states, cap: 1 })]).toEqual(['t1:a'])
  })
})
