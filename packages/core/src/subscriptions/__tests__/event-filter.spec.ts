import { describe, expect, it } from 'bun:test'

import {
  catalogText,
  deliversEvent,
  filterLabelSuffix,
  resolveEventFilter,
  type SubscriptionEventCatalog,
} from '../event-filter'

const CATALOG: SubscriptionEventCatalog = [
  { name: 'comments', summary: 'comments, reviews and review comments' },
  { name: 'ci', summary: 'CI verdicts' },
  { name: 'state', summary: 'merged, closed or reopened', alwaysDelivered: true },
]

describe('resolveEventFilter', () => {
  it('treats an omitted or empty request as every event', () => {
    expect(resolveEventFilter({ catalog: CATALOG })).toEqual({ ok: true, events: [] })
    expect(resolveEventFilter({ catalog: CATALOG, requested: [] })).toEqual({
      ok: true,
      events: [],
    })
  })

  it('sorts and dedupes the requested events', () => {
    expect(resolveEventFilter({ catalog: CATALOG, requested: ['ci', 'comments', 'ci'] })).toEqual({
      ok: true,
      events: ['ci', 'comments'],
    })
  })

  it('refuses an unknown event and lists the valid ones', () => {
    const outcome = resolveEventFilter({ catalog: CATALOG, requested: ['ci', 'nope'] })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.error).toContain('"nope"')
    expect(outcome.ok ? '' : outcome.error).toContain('Valid events: ci, comments, state')
  })

  it('refuses a filter for a catalog that has no events, naming the provider', () => {
    expect(
      resolveEventFilter({ catalog: [], requested: ['ci'], provider: 'github.workflow-run' }),
    ).toEqual({
      ok: false,
      error: 'github.workflow-run has no event filter; it delivers every occurrence.',
    })
  })
})

describe('deliversEvent', () => {
  it('delivers everything to a subscription with no filter', () => {
    expect(deliversEvent({ catalog: CATALOG, events: [], name: 'comments' })).toBe(true)
  })

  it('delivers a named event and refuses one left out', () => {
    expect(deliversEvent({ catalog: CATALOG, events: ['ci'], name: 'ci' })).toBe(true)
    expect(deliversEvent({ catalog: CATALOG, events: ['ci'], name: 'comments' })).toBe(false)
  })

  it('delivers an always-delivered event even when the filter leaves it out', () => {
    expect(deliversEvent({ catalog: CATALOG, events: ['ci'], name: 'state' })).toBe(true)
  })

  it('delivers nothing outside the catalog when a filter is set', () => {
    expect(deliversEvent({ catalog: CATALOG, events: ['ci'], name: 'unknown' })).toBe(false)
  })
})

describe('catalog and label text', () => {
  it('lists the catalog and marks the always-delivered events', () => {
    expect(catalogText(CATALOG)).toBe('comments, ci, state (state always delivered)')
    expect(catalogText([])).toBe('')
  })

  it('suffixes a label only when a filter is set', () => {
    expect(filterLabelSuffix([])).toBe('')
    expect(filterLabelSuffix(['state', 'ci', 'state'])).toBe(' (only: ci, state)')
  })
})
