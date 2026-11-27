import { describe, expect, it } from 'bun:test'

import { called, eventsFrom, replied, resulted, said } from '../../compaction/__tests__/fixture'
import { SESSION_EXCERPT_GAP, sessionExcerptOf } from '../session-excerpt'

describe('sessionExcerptOf', () => {
  it('is empty for a session with nothing said', () => {
    expect(sessionExcerptOf({ events: [] })).toBe('')
  })

  it('keeps the whole conversation when it fits, without tool traffic', () => {
    const events = eventsFrom([
      said('fix the login page'),
      called('c1'),
      resulted('c1'),
      replied('Fixed the cookie check'),
    ])
    expect(sessionExcerptOf({ events })).toBe(
      'Operator: fix the login page\nAtlas: Fixed the cookie check',
    )
  })

  it('keeps the opening and the most recent lines, and marks the gap', () => {
    const events = eventsFrom([
      said('fix the login page'),
      replied('a'.repeat(50)),
      said('now port the sidebar'),
      replied('Sidebar ported'),
    ])
    const excerpt = sessionExcerptOf({ events, limit: 90 })
    expect(excerpt).toBe(
      [
        'Operator: fix the login page',
        SESSION_EXCERPT_GAP,
        'Operator: now port the sidebar',
        'Atlas: Sidebar ported',
      ].join('\n'),
    )
  })
})
