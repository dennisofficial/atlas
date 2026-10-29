import { ERuntimePhase } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  ESeededSubscription,
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

  it('never wakes the sandbox of an archived thread', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    await db.orm.public.Thread.where({ id: 'thr-1' }).update({ archivedAt: new Date() })
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

  it('never wakes a thread that holds a transport row but no subscription', async () => {
    await seedParkedSandbox()
    await seedSubscription({ subscription: ESeededSubscription.Absent })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('never wakes a thread whose subscription is paused', async () => {
    await seedParkedSandbox()
    await seedSubscription({ subscription: ESeededSubscription.Paused })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('never wakes a thread subscribed to a different pull request', async () => {
    await seedParkedSandbox()
    await seedSubscription({ target: { repo: 'github.com/compai/app', number: 7 } })
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
