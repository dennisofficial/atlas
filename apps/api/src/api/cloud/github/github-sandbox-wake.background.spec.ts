import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import {
  fake,
  fakeBoot,
  flushDebounce,
  PR_EVENT,
  RecordingBackgroundWork,
  seedParkedSandbox,
  seedSubscription,
  serviceWith,
} from '../../../../test/github-sandbox-wake-fixture'

describe('GithubSandboxWakeService background work', () => {
  beforeEach(() => {
    fake.reset()
    vi.useFakeTimers()
  })

  it('hands the lookup to keepAlive, and with no debounce the boot has run once that promise settles', async () => {
    seedSubscription()
    seedParkedSandbox()
    const { boot, calls } = fakeBoot()
    const background = new RecordingBackgroundWork()
    const wake = serviceWith({ boot, background, debounceMs: 0 })

    wake.notifyEvent(PR_EVENT)
    expect(background.kept).toHaveLength(1)
    await background.kept[0]

    expect(calls).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(fake.cloudSandboxes[0]?.state).toBe('running')
  })

  it('also hands the boot itself to keepAlive when there is no debounce', async () => {
    seedSubscription()
    seedParkedSandbox()
    const { boot } = fakeBoot()
    const background = new RecordingBackgroundWork()

    serviceWith({ boot, background, debounceMs: 0 }).notifyEvent(PR_EVENT)
    await Promise.all(background.kept)

    expect(background.kept).toHaveLength(2)
  })

  it('keeps a lookup alive until a held boot finishes when there is no debounce', async () => {
    seedSubscription()
    seedParkedSandbox()
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const { boot } = fakeBoot({ held })
    const background = new RecordingBackgroundWork()

    serviceWith({ boot, background, debounceMs: 0 }).notifyEvent(PR_EVENT)
    let lookupDone = false
    void background.kept[0]?.then(() => {
      lookupDone = true
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(lookupDone).toBe(false)

    release()
    await background.kept[0]
    expect(lookupDone).toBe(true)
  })

  it('with the normal debounce the lookup is kept alive and the boot waits for the timer', async () => {
    seedSubscription()
    seedParkedSandbox()
    const { boot, calls } = fakeBoot()
    const background = new RecordingBackgroundWork()
    const wake = serviceWith({ boot, background })

    wake.notifyEvent(PR_EVENT)
    await background.kept[0]
    expect(calls).toHaveLength(0)
    expect(background.kept).toHaveLength(1)

    await flushDebounce()
    expect(calls).toHaveLength(1)
    expect(background.kept).toHaveLength(2)
  })
})
