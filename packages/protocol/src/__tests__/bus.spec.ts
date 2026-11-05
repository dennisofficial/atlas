import { describe, expect, it } from 'bun:test'

import {
  PG_HOST_CHANGE_CHANNEL,
  PG_PRESENCE_LOCK_NAMESPACE,
  PG_WAKE_CHANNEL,
  sessionLiveChannel,
} from '../bus'

describe('bus names', () => {
  it('names the postgres wake channel', () => {
    expect(PG_WAKE_CHANNEL).toBe('atlas_session_wake')
  })

  it('names the host change channel', () => {
    expect(PG_HOST_CHANGE_CHANNEL).toBe('atlas_host_change')
  })

  it('namespaces presence locks with a fixed int4 key', () => {
    expect(PG_PRESENCE_LOCK_NAMESPACE).toBe(1095060563)
    expect(Number.isInteger(PG_PRESENCE_LOCK_NAMESPACE)).toBe(true)
    expect(PG_PRESENCE_LOCK_NAMESPACE).toBeLessThanOrEqual(2 ** 31 - 1)
  })

  it('names a per-session live channel', () => {
    expect(sessionLiveChannel('session-1')).toBe('atlas:session-live:session-1')
  })
})
