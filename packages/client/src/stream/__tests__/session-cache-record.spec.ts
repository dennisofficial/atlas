import { describe, expect, it } from 'bun:test'

import {
  evictionsFrom,
  SESSION_CACHE_LIMIT,
  SESSION_CACHE_RECORD_VERSION,
  windowFromRecord,
} from '../session-cache-record'
import type { SessionWindow } from '../session-window'

const windowAt = (seq: number): SessionWindow => ({
  events: [],
  visibility: { spans: [] },
  cursor: { seq, hash: `h${seq}` },
})

const recordOf = (window: SessionWindow): unknown => ({
  version: SESSION_CACHE_RECORD_VERSION,
  savedAt: 1,
  window,
})

describe('windowFromRecord', () => {
  it('reads a whole record', () => {
    expect(windowFromRecord({ value: recordOf(windowAt(4)) })).toEqual(windowAt(4))
  })

  it('drops another version', () => {
    const value = { ...(recordOf(windowAt(4)) as object), version: 2 }
    expect(windowFromRecord({ value })).toBeUndefined()
  })

  it('drops a record without a savedAt stamp', () => {
    expect(windowFromRecord({ value: { version: 1, window: windowAt(4) } })).toBeUndefined()
  })

  it('drops a window without visibility', () => {
    const { visibility: _visibility, ...partial } = windowAt(4)
    expect(windowFromRecord({ value: { version: 1, savedAt: 1, window: partial } })).toBeUndefined()
  })

  it('drops a window holding an unreadable event', () => {
    const window = { ...windowAt(4), events: [{ type: 'user-said' }] }
    expect(windowFromRecord({ value: { version: 1, savedAt: 1, window } })).toBeUndefined()
  })

  it('drops a window with a malformed cursor', () => {
    const window = { ...windowAt(4), cursor: { seq: 'four', hash: 'h4' } }
    expect(windowFromRecord({ value: { version: 1, savedAt: 1, window } })).toBeUndefined()
  })

  it('keeps a window with no cursor yet', () => {
    const window: SessionWindow = { events: [], visibility: { spans: [] }, cursor: undefined }
    expect(windowFromRecord({ value: { version: 1, savedAt: 1, window } })).toEqual(window)
  })
})

describe('evictionsFrom', () => {
  it('keeps the newest entries up to the limit', () => {
    const entries = Array.from({ length: SESSION_CACHE_LIMIT + 2 }, (_unused, index) => ({
      key: `s${index}`,
      savedAt: index,
    }))

    expect(evictionsFrom({ entries })).toEqual(['s0', 's1'])
  })

  it('evicts nothing at the limit', () => {
    const entries = Array.from({ length: SESSION_CACHE_LIMIT }, (_unused, index) => ({
      key: `s${index}`,
      savedAt: index,
    }))

    expect(evictionsFrom({ entries })).toEqual([])
  })

  it('evicts by savedAt rather than insertion order', () => {
    const entries = [
      { key: 'old', savedAt: 1 },
      { key: 'fresh', savedAt: 9 },
      { key: 'middle', savedAt: 5 },
    ]

    expect(evictionsFrom({ entries, limit: 2 })).toEqual(['old'])
  })
})
