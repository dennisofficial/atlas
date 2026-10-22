import { ERuntimePhase } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
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
} from '../../../../test/github-sandbox-wake-fixture'
import { PARK_WAKE_WINDOW_MS } from './github-delivery-routing'
import { unstubAllGlobals } from '@dltech/bun-test-shims'

describe('GithubSandboxWakeService eligibility', () => {
  useTestDatabase()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    unstubAllGlobals()
    vi.useRealTimers()
  })

  it('ignores sandboxes whose mirrored record is serving, even if the legacy column says parked', async () => {
    const serving = mirroredRecord({ phase: ERuntimePhase.Serving })
    await seedParkedSandbox({
      runtimeCheckpoint: serving,
      runtimeCheckpointRevision: serving.revision,
    })
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('never wakes a sandbox still parking', async () => {
    const parking = mirroredRecord({ phase: ERuntimePhase.Parking })
    await seedParkedSandbox({
      runtimeCheckpoint: parking,
      runtimeCheckpointRevision: parking.revision,
    })
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('falls back to the legacy state column for a row no serve has mirrored onto', async () => {
    await seedParkedSandbox({ runtimeCheckpoint: null, runtimeCheckpointRevision: null })
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(1)
  })

  it('ignores parked sandboxes whose last activity fell outside the wake window', async () => {
    await seedParkedSandbox({ lastActivityAt: pastDate(PARK_WAKE_WINDOW_MS + 60_000) })
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('ignores subscriptions without a thread link', async () => {
    await seedSubscription({ threadId: null })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('skips the boot when serve mirrored a newer record during the debounce window', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    const serving = mirroredRecord({ phase: ERuntimePhase.Serving, revision: 5 })
    await patchSandbox({ runtimeCheckpoint: serving, runtimeCheckpointRevision: serving.revision })
    await flushDebounce()

    expect(calls).toHaveLength(0)
    expect((await readSandbox()).wakeClaim).toBeNull()
  })
})
