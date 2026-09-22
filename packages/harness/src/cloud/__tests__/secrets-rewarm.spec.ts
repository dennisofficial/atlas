import { describe, expect, it } from 'bun:test'

import { scheduleSecretsRewarm } from '../secrets-rewarm'

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('scheduleSecretsRewarm', () => {
  it('warms on the interval until stopped', async () => {
    let warms = 0
    const stop = scheduleSecretsRewarm({
      warm: async () => {
        warms += 1
      },
      intervalMs: 5,
    })

    await tick(30)
    expect(warms).toBeGreaterThanOrEqual(2)

    stop()
    const held = warms
    await tick(20)
    expect(warms).toBe(held)
  })

  it('keeps ticking when a warm fails', async () => {
    let warms = 0
    const stop = scheduleSecretsRewarm({
      warm: async () => {
        warms += 1
        throw new Error('cloud down')
      },
      intervalMs: 5,
    })

    await tick(30)
    stop()

    expect(warms).toBeGreaterThanOrEqual(2)
  })
})
