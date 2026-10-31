import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import type { SessionActivityPort } from '../port'
import { UnavailableSessionActivity } from '../unavailable-session-activity'

describe('unavailable home-copy activity', () => {
  it('refuses activity reads instead of manufacturing idle or a runtime identity', async () => {
    const activity: SessionActivityPort = new UnavailableSessionActivity()
    await expect(activity.read({ threadId: toThreadId('parked-copy') })).rejects.toThrow(
      'Activity is unavailable from a local transcript copy',
    )
  })
})
