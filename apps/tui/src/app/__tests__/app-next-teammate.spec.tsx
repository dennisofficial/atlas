import { describe, expect, test } from 'bun:test'

import { frameShowing } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { openSession, SESSION_ID, WITHIN } from './app-next-harness'
import { sessionRowFixture } from './view-fixture'

describe('a teammate row', () => {
  test('a spawned session shows under Teammates with its state as activity', async () => {
    const mounted = await openSession({
      rows: [
        sessionRowFixture({ sessionId: SESSION_ID, title: 'the open session' }),
        sessionRowFixture({
          sessionId: 'mate-1',
          title: 'the running mate',
          spawnedBy: SESSION_ID,
          updatedAt: '2026-11-21T00:00:00.000Z',
          status: { state: 'idle' as never },
        }),
      ],
    })

    try {
      const frame = await frameShowing({
        setup: mounted.setup,
        text: 'the running mate',
        within: WITHIN,
      })
      expect(frame).toContain('TEAMMATES')
      expect(frame).toContain('idle')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
