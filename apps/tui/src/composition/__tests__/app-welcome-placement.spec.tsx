import { afterEach, describe, expect, it } from 'bun:test'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { until } from './app-fixture'
import { bornThreadApp, mountUnborn } from './born-thread-fixture'

await grammarsReady()

afterEach(() => dismissNotice())

const RUNNER_HINT = '↓ to the footer chip, ⏎ to switch runner'

describe('the welcome hero placement shape', () => {
  it('surfaces the pod preference and its hint on a fresh thread', async () => {
    const mounted = await mountUnborn({ app: bornThreadApp({ shape: 'hero' }) })

    try {
      expect(await mounted.frameHolds((frame) => frame.includes('· pod') && frame.includes(RUNNER_HINT))).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('retires with the first message, footer chip and all', async () => {
    const mounted = await mountUnborn({ app: bornThreadApp({ shape: 'hero' }) })

    try {
      expect(await mounted.frameHolds((frame) => frame.includes(RUNNER_HINT))).toBe(true)

      await mounted.command('hello from the hero')

      expect(
        await mounted.frameHolds((frame) => !frame.includes(RUNNER_HINT) && !frame.includes('pod ▾')),
      ).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows no placement in the hero while the setting is unset', async () => {
    const mounted = await mountUnborn({ app: bornThreadApp({}) })

    try {
      expect(await mounted.frameHolds((frame) => frame.includes('pod ▾'))).toBe(true)
      const frame = await mounted.frame()

      expect(frame).not.toContain(RUNNER_HINT)
      expect(frame).not.toContain('· pod')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('flips the preference through the footer chip without starting anything', async () => {
    const mounted = await mountUnborn({ app: bornThreadApp({ shape: 'hero', vercel: true }) })

    try {
      expect(await mounted.frameHolds((frame) => frame.includes('· pod'))).toBe(true)
      await mounted.flipChip()

      expect(await mounted.frameHolds((frame) => frame.includes('· ☁ cloud'))).toBe(true)
      expect(await until({ holds: async () => mounted.bridge.created.length === 0, within: 1_000 })).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
