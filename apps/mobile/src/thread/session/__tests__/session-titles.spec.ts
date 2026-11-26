import { describe, expect, it } from 'bun:test'

import { sessionTitlesOf } from '../session-titles'

const EMPTY = new Map<string, string>()

describe('sessionTitlesOf', () => {
  it('keeps the previous map when only other fields of the session rows change', () => {
    const first = sessionTitlesOf({
      rows: [
        { sessionId: 'a', title: 'Alpha' },
        { sessionId: 'b', title: 'Beta' },
      ],
      previous: EMPTY,
    })
    const next = sessionTitlesOf({
      rows: [
        { sessionId: 'b', title: 'Beta' },
        { sessionId: 'a', title: 'Alpha' },
      ],
      previous: first,
    })

    expect(next).toBe(first)
  })

  it('returns a new map when a title changes', () => {
    const first = sessionTitlesOf({ rows: [{ sessionId: 'a', title: 'Alpha' }], previous: EMPTY })
    const next = sessionTitlesOf({ rows: [{ sessionId: 'a', title: 'Renamed' }], previous: first })

    expect(next).not.toBe(first)
    expect(next.get('a')).toBe('Renamed')
  })

  it('returns a new map when a session appears or disappears', () => {
    const first = sessionTitlesOf({ rows: [{ sessionId: 'a', title: 'Alpha' }], previous: EMPTY })

    expect(
      sessionTitlesOf({
        rows: [
          { sessionId: 'a', title: 'Alpha' },
          { sessionId: 'b', title: 'Beta' },
        ],
        previous: first,
      }).size,
    ).toBe(2)
    expect(sessionTitlesOf({ rows: [], previous: first }).size).toBe(0)
  })

  it('skips sessions without a title and keeps the empty map while the feed loads', () => {
    expect(sessionTitlesOf({ rows: undefined, previous: EMPTY })).toBe(EMPTY)
    expect(sessionTitlesOf({ rows: [{ sessionId: 'a', title: null }], previous: EMPTY })).toBe(
      EMPTY,
    )
  })
})
