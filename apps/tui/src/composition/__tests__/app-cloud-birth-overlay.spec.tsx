import { afterEach, describe, expect, it } from 'vitest'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { until } from './app-fixture'
import { bornThreadApp, holdingProvisioning, mountUnborn } from './born-thread-fixture'

await grammarsReady()

afterEach(() => dismissNotice())

describe('the birth overlay on a first send', () => {
  it('blocks the composer with the cancellable pod overlay until the pod is up', async () => {
    const bridge = fakeBridge()
    const held = holdingProvisioning(bridge)
    const mounted = await mountUnborn({ app: bornThreadApp({}), bridge })

    try {
      await mounted.command('wake the pod')

      const blocked = await mounted.frameHolds(
        (frame) => frame.includes('STARTING A POD') && frame.includes('cancel and keep the draft'),
      )
      expect(blocked).toBe(true)
      expect(bridge.created.length).toBe(0)

      await mounted.command('typed under the overlay')
      expect(mounted.draft()).toBe('')

      held.release()
      expect(await until({ holds: async () => bridge.created.length === 1, within: 20_000 })).toBe(true)
    } finally {
      held.release()
      await mounted.done()
    }
  }, 60_000)
})
