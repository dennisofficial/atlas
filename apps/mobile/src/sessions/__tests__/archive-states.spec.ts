import { describe, expect, it } from 'bun:test'

import { archiveStatesOf } from '../archive-states'

describe('the archive states of a session list', () => {
  it('marks a session archived only when it carries an archive stamp', () => {
    expect(
      archiveStatesOf([
        { sessionId: 's1', archivedAt: '2026-11-24T10:00:00.000Z' },
        { sessionId: 's2', archivedAt: null },
        { sessionId: 's3', archivedAt: undefined },
      ]),
    ).toEqual([
      { sessionId: 's1', archived: true },
      { sessionId: 's2', archived: false },
      { sessionId: 's3', archived: false },
    ])
  })

  it('keeps one state per row, in order', () => {
    expect(archiveStatesOf([])).toEqual([])
    expect(
      archiveStatesOf([
        { sessionId: 'b', archivedAt: null },
        { sessionId: 'a', archivedAt: null },
      ]).map((state) => state.sessionId),
    ).toEqual(['b', 'a'])
  })
})
