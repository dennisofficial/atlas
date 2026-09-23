import { describe, expect, it } from 'bun:test'

import { grammarsReady, settle } from '../../ui/markdown/__tests__/harness'
import {
  CLOUD_HEADING,
  CLOUD_SUBTITLE,
  HEADING as LOCAL_HEADING,
} from '../../ui/components/exit-guard'
import { DETACH_NOTE } from '../../ui/exit-guard-model'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { mount, slowlySpeaking, speaking } from './app-container-cloud-fixture'

await grammarsReady()

const PRESS_MS = 60

describe('leaving a cloud conversation', () => {
  it('offers detach, saying what survives, and never stopping tasks', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')

      mounted.pressCtrlC()
      await settle(PRESS_MS)
      const frame = await mounted.frame()

      expect(frame).toContain(CLOUD_HEADING)
      expect(frame).toContain(CLOUD_SUBTITLE)
      expect(frame).toContain('Move to background and exit')
      expect(frame).toContain(DETACH_NOTE.split(';')[0] ?? '')
      expect(frame).not.toContain(LOCAL_HEADING)
      expect(frame).not.toContain('Exit and stop tasks')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('asks rather than interrupting when the turn is still running', async () => {
    const app = slowlySpeaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')
      await mounted.say('take your time with this')

      mounted.pressCtrlC()
      await settle(PRESS_MS)
      const frame = await mounted.frame()

      expect(frame).toContain(CLOUD_HEADING)
      expect(bridge.channel.runs).toBe(1)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('closes the socket and leaves the sandbox alone when detach is picked', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    await mounted.run('cloud')

    mounted.pressCtrlC()
    await settle(PRESS_MS)
    await mounted.frame()
    mounted.pressEnter()
    await settle(PRESS_MS)

    expect(bridge.channel.closed).toBe(true)
    expect(bridge.destroyed).toHaveLength(0)
  }, 60_000)

  it('stays when the guard is talked down', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')

      mounted.pressCtrlC()
      await settle(PRESS_MS)
      expect(await mounted.frame()).toContain(CLOUD_HEADING)

      mounted.pressEscape()
      await settle(PRESS_MS)
      const frame = await mounted.frame()

      expect(frame).not.toContain(CLOUD_HEADING)
      expect(bridge.channel.closed).toBe(false)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
