import { describe, expect, it } from 'bun:test'

import { PG_WAKE_CHANNEL, sessionLiveChannel } from '../bus'

describe('bus names', () => {
  it('names the postgres wake channel', () => {
    expect(PG_WAKE_CHANNEL).toBe('atlas_session_wake')
  })

  it('names a per-session live channel', () => {
    expect(sessionLiveChannel('session-1')).toBe('atlas:session-live:session-1')
  })
})
