import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'
import { ETurnStatus } from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { until, THREAD } from './app-fixture'
import { mount, slowlySpeaking } from './app-container-cloud-fixture'

await grammarsReady()

describe('a mid-turn lift', () => {
  it('interrupts a turn in flight, lifts it, and resumes it in the cloud without being asked', async () => {
    const app = slowlySpeaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await mounted.typeText('keep going')
      mounted.pressEnter()

      const working = await until({
        holds: async () => (await mounted.nextFrame()).includes('esc to interrupt'),
        within: 20_000,
      })
      expect(working).toBe(true)

      await mounted.typeText('/container cloud')
      mounted.pressEnter()

      const attached = await until({
        holds: async () => bridge.attached.length === 1,
        within: 20_000,
      })
      expect(attached).toBe(true)

      const ran = await until({
        holds: async () => bridge.channel.runs === 1,
        within: 20_000,
      })
      expect(ran).toBe(true)

      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-cloud-resume') })

      const settled = await until({
        holds: async () => !(await mounted.nextFrame()).includes('esc to interrupt'),
        within: 20_000,
      })
      expect(settled).toBe(true)

      expect(JSON.stringify(bridge.log.peek({ threadId: THREAD }))).toContain('keep going')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
