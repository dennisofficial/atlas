import { describe, expect, it } from 'bun:test'

import {
  applyArchiveOverrides,
  NO_ARCHIVE_OVERRIDES,
  settledArchiveOverrides,
  withArchiveOverride,
} from '../archive-overrides'

const sessionOf = (sessionId: string, archivedAt: string | null = null) => ({
  sessionId,
  archivedAt,
  title: sessionId,
})

const STAMP = '2026-11-24T10:00:00.000Z'

describe('archive overrides', () => {
  it('stamps archivedAt so the row leaves the active list at once', () => {
    const overrides = withArchiveOverride({
      overrides: NO_ARCHIVE_OVERRIDES,
      sessionId: 'ses_a',
      archivedAt: STAMP,
    })
    const sessions = applyArchiveOverrides({
      sessions: [sessionOf('ses_a'), sessionOf('ses_b')],
      overrides,
    })
    expect(sessions.map((session) => session.archivedAt)).toEqual([STAMP, null])
    expect(sessions[1]).toEqual(sessionOf('ses_b'))
  })

  it('returns to the original list when the override is cleared', () => {
    const overrides = withArchiveOverride({
      overrides: withArchiveOverride({
        overrides: NO_ARCHIVE_OVERRIDES,
        sessionId: 'ses_a',
        archivedAt: STAMP,
      }),
      sessionId: 'ses_a',
      archivedAt: undefined,
    })
    expect(
      applyArchiveOverrides({ sessions: [sessionOf('ses_a')], overrides }).map(
        (session) => session.archivedAt,
      ),
    ).toEqual([null])
  })

  it('unarchives a row that the server sent as archived', () => {
    const overrides = withArchiveOverride({
      overrides: NO_ARCHIVE_OVERRIDES,
      sessionId: 'ses_a',
      archivedAt: null,
    })
    expect(
      applyArchiveOverrides({ sessions: [sessionOf('ses_a', STAMP)], overrides }).map(
        (session) => session.archivedAt,
      ),
    ).toEqual([null])
  })

  it('keeps the listed sessions untouched with no overrides', () => {
    const sessions = [sessionOf('ses_a')]
    expect(applyArchiveOverrides({ sessions, overrides: NO_ARCHIVE_OVERRIDES })).toBe(sessions)
  })

  it('drops an override once the server reflects it', () => {
    const overrides = withArchiveOverride({
      overrides: NO_ARCHIVE_OVERRIDES,
      sessionId: 'ses_a',
      archivedAt: STAMP,
    })
    expect(settledArchiveOverrides({ overrides, sessions: [sessionOf('ses_a', STAMP)] }).size).toBe(
      0,
    )
  })

  it('keeps an override the server does not reflect yet', () => {
    const overrides = withArchiveOverride({
      overrides: NO_ARCHIVE_OVERRIDES,
      sessionId: 'ses_a',
      archivedAt: STAMP,
    })
    expect(settledArchiveOverrides({ overrides, sessions: [sessionOf('ses_a')] })).toBe(overrides)
  })
})
