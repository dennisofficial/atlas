import { Logger } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  advanceDebounce,
  failingBoot,
  fakeBoot,
  flushDebounce,
  PR_EVENT,
  readSandbox,
  seedParkedSandbox,
  seedSubscription,
  serviceWith,
  useWakeFixture,
  settleLookups,
} from '../../../../test/github-sandbox-wake-fixture'
import { unstubAllGlobals } from '@dltech/bun-test-shims'
import { advanceTimersByTimeAsync } from '../../../../test/fake-timers'

describe('GithubSandboxWakeService settle', () => {
  useTestDatabase()
  useWakeFixture()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    unstubAllGlobals()
    vi.useRealTimers()
  })

  it('boots a debounced target immediately, exactly once, and the timer never fires a second boot', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()
    const wake = serviceWith({ boot })

    const timersBefore = vi.getTimerCount()

    wake.notifyEvent(PR_EVENT)
    await settleLookups()
    await advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(0)
    expect(vi.getTimerCount()).toBeGreaterThan(timersBefore)

    await wake.settle()
    expect(calls).toHaveLength(1)
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timersBefore)

    await flushDebounce()
    expect(calls).toHaveLength(1)
  })

  it('awaits a lookup still in flight, then boots', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()
    const wake = serviceWith({ boot })

    wake.notifyEvent(PR_EVENT)
    await wake.settle()

    expect(calls).toHaveLength(1)
    expect((await readSandbox()).state).toBe('running')
  })

  it('awaits a boot already running before resolving', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const gate: { release: () => void } = { release: () => {} }
    const held = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    const { boot, calls, entered } = fakeBoot({ held })
    const wake = serviceWith({ boot })

    wake.notifyEvent(PR_EVENT)
    await advanceDebounce()
    await entered
    expect(calls).toHaveLength(1)

    let settled = false
    const settling = wake.settle().then(() => {
      settled = true
    })
    await advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    gate.release()
    await settling
    expect((await readSandbox()).state).toBe('running')
  })

  it('resolves when nothing is pending', async () => {
    const { boot, calls } = fakeBoot()

    await expect(serviceWith({ boot }).settle()).resolves.toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  it('logs a failing boot instead of throwing', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const wake = serviceWith({ boot: failingBoot() })

    wake.notifyEvent(PR_EVENT)
    await expect(wake.settle()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vercel is down'))
    expect((await readSandbox()).wakeClaim).toBeNull()
    warn.mockRestore()
  })
})
