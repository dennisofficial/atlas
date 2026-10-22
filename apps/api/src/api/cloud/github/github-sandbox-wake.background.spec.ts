import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  fakeBoot,
  flushDebounce,
  readSandbox,
  PR_EVENT,
  RecordingBackgroundWork,
  seedParkedSandbox,
  seedSubscription,
  serviceWith,
} from '../../../../test/github-sandbox-wake-fixture'

describe('GithubSandboxWakeService background work', () => {
  useTestDatabase()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('hands the lookup to keepAlive, and with no debounce the boot has run once that promise settles', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()
    const background = new RecordingBackgroundWork()
    const wake = serviceWith({ boot, background, debounceMs: 0 })
    const timersBefore = vi.getTimerCount()

    wake.notifyEvent(PR_EVENT)
    expect(background.kept).toHaveLength(1)
    await background.kept[0]

    expect(calls).toHaveLength(1)
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timersBefore)
    expect((await readSandbox()).state).toBe('running')
  })

  it('also hands the boot itself to keepAlive when there is no debounce', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot } = fakeBoot()
    const background = new RecordingBackgroundWork()

    serviceWith({ boot, background, debounceMs: 0 }).notifyEvent(PR_EVENT)
    await Promise.all(background.kept)

    expect(background.kept).toHaveLength(2)
  })

  it('keeps a lookup alive until a held boot finishes when there is no debounce', async () => {
    await seedParkedSandbox()
    await seedSubscription()
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
    await seedParkedSandbox()
    await seedSubscription()
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
