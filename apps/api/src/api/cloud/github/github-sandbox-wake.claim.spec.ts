import { ERuntimePhase } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  advanceDebounce,
  failingBoot,
  fakeBoot,
  flushDebounce,
  mirroredRecord,
  patchSandbox,
  pastDate,
  PR_EVENT,
  readSandbox,
  seedParkedSandbox,
  seedSubscription,
  serviceWith,
  settleLookups,
} from '../../../../test/github-sandbox-wake-fixture'
import { sandboxStateOf } from '../../platform/sandboxes/sandbox-lifecycle'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { WAKE_FAILURE_BACKOFF_MS } from './github-sandbox-wake.service'
import { unstubAllGlobals } from '@dltech/bun-test-shims'
import { advanceTimersByTimeAsync } from '../../../../test/fake-timers'

describe('GithubSandboxWakeService claim and backoff', () => {
  useTestDatabase()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    unstubAllGlobals()
    vi.useRealTimers()
  })

  it('coalesces an event storm into one boot per thread', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()
    const wake = serviceWith({ boot })

    for (let i = 0; i < 6; i += 1) {
      wake.notifyEvent(PR_EVENT)
      await settleLookups()
      await advanceTimersByTimeAsync(1_000)
    }
    await flushDebounce()

    expect(calls).toHaveLength(1)
  })

  it('boots each distinct thread once', async () => {
    for (const threadId of ['thr-1', 'thr-2']) {
      const parked = mirroredRecord({ threadId, phase: ERuntimePhase.Parked })
      await seedParkedSandbox({
        threadId,
        name: `atlas-sandbox-${threadId}`,
        tokenHash: `hash-${threadId}`,
        runtimeCheckpoint: parked,
        runtimeCheckpointRevision: parked.revision,
      })
      await seedSubscription({ threadId })
    }
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(new Set(calls.map((call) => call.threadId))).toEqual(new Set(['thr-1', 'thr-2']))
  })

  it('claims through wakeClaim before booting, so a second instance cannot double-boot', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const gate: { release: () => void } = { release: () => {} }
    const held = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    const first = fakeBoot({ held })
    const second = fakeBoot()

    serviceWith({ boot: first.boot }).notifyEvent(PR_EVENT)
    await advanceDebounce()
    await first.entered
    expect(first.calls).toHaveLength(1)
    const claimed = await readSandbox()
    expect(claimed.wakeClaim).toBeInstanceOf(Date)
    expect(sandboxStateOf(claimed)).toBe(ESandboxState.Resuming)

    serviceWith({ boot: second.boot }).notifyEvent(PR_EVENT)
    await flushDebounce()
    expect(second.calls).toHaveLength(0)

    gate.release()
    await flushDebounce()
    expect(first.calls).toHaveLength(1)
  })

  it('a boot failure releases the claim and records wakeFailedAt for backoff', async () => {
    await seedParkedSandbox()
    await seedSubscription()

    serviceWith({ boot: failingBoot() }).notifyEvent(PR_EVENT)
    await flushDebounce()

    const released = await readSandbox()
    expect(released.wakeClaim).toBeNull()
    expect(released.wakeFailedAt).toBeInstanceOf(Date)
    expect(sandboxStateOf(released)).toBe(ESandboxState.Parked)
  })

  it('a recent wake failure backs the target off until the backoff window passes', async () => {
    await seedParkedSandbox({ wakeFailedAt: pastDate(60_000) })
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()
    expect(calls).toHaveLength(0)

    await patchSandbox({ wakeFailedAt: pastDate(WAKE_FAILURE_BACKOFF_MS + 60_000) })
    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()
    expect(calls).toHaveLength(1)
  })
})
