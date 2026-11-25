import { describe, expect, it } from 'bun:test'

import { handledQuickStopsOf, rememberHandledQuickStops } from '../handled-quick-stops'

describe('handled quick stops', () => {
  it('keeps the rewind ids across a remount of the same session', () => {
    rememberHandledQuickStops({ sessionId: 'ses-1', rewindEventIds: ['evt-1'] })

    expect(handledQuickStopsOf('ses-1').has('evt-1')).toBe(true)
  })

  it('keeps each session apart', () => {
    rememberHandledQuickStops({ sessionId: 'ses-2', rewindEventIds: ['evt-2'] })

    expect(handledQuickStopsOf('ses-3').size).toBe(0)
    expect(handledQuickStopsOf('ses-2').has('evt-2')).toBe(true)
  })
})
