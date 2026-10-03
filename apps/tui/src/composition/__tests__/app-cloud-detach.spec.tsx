import { describe, expect, it } from 'bun:test'

import { grammarsReady, settle } from '../../ui/markdown/__tests__/harness'
import { HEADING } from '../../ui/components/exit-guard'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { DETACHED_EXIT_LINE } from '../use-workspace-exit'
import { mount, slowlySpeaking, speaking } from './app-container-cloud-fixture'

await grammarsReady()

const PRESS_MS = 60

describe('leaving a cloud conversation', () => {
  it('detaches without asking, closing the socket and leaving the sandbox alone', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    await mounted.run('cloud')

    mounted.pressCtrlC()
    await settle(PRESS_MS)

    expect(bridge.channel.closed).toBe(true)
    expect(bridge.destroyed).toHaveLength(0)
  }, 60_000)

  it('never shows the local stop-tasks guard on the way out', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')
      const before = await mounted.frame()

      expect(before).not.toContain(HEADING)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('detaches mid-turn rather than interrupting the work on the sandbox', async () => {
    const app = slowlySpeaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    await mounted.run('cloud')
    await mounted.say('take your time with this')

    mounted.pressCtrlC()
    await settle(PRESS_MS)

    expect(bridge.channel.sent.map((said) => said.text)).toEqual(['take your time with this'])
    expect(bridge.channel.closed).toBe(true)
    expect(bridge.destroyed).toHaveLength(0)
  }, 60_000)

  it('says what survives when it detaches', () => {
    expect(DETACHED_EXIT_LINE).toContain('turn keeps running')
    expect(DETACHED_EXIT_LINE).toContain('filesystem persists via snapshot')
    expect(DETACHED_EXIT_LINE).toContain('services die on park')
  })
})
