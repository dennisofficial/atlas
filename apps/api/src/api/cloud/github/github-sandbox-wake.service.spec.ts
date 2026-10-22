import { ERuntimePhase } from '@dltech/atlas-wire'
import { Logger } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cipher,
  failingBoot,
  fakeBoot,
  advanceDebounce,
  flushDebounce,
  settleLookups,
  mirroredRecord,
  patchSandbox,
  pastDate,
  PR_EVENT,
  readSandbox,
  releaseArtifactCheck,
  seedParkedSandbox,
  STORED_HASH,
  seedSubscription,
  serviceWith,
} from '../../../../test/github-sandbox-wake-fixture'
import { hashSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { sandboxStateOf } from '../../platform/sandboxes/sandbox-lifecycle'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { PARK_WAKE_WINDOW_MS } from './github-delivery-routing'
import { WAKE_DEBOUNCE_MS, WAKE_FAILURE_BACKOFF_MS } from './github-sandbox-wake.service'

describe('GithubSandboxWakeService', () => {
  useTestDatabase()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resumes a parked sandbox with its stored token and leaves the token columns alone', async () => {
    await seedParkedSandbox({ serveVersion: '1.92.6' })
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      name: 'atlas-sandbox-abc',
      threadId: 'thr-1',
      image: 'atlas-sandbox:latest',
      cloudUrl: 'https://api.byatlas.io',
      serveVersion: '1.92.6',
      resumeToken: 'stored-token',
    })
    expect(calls[0]).not.toHaveProperty('driveName')
    expect(calls[0]?.credentials).toEqual({ token: 'vercel-token', teamId: 'team-1', projectId: 'proj-1' })
    const held = await readSandbox()
    expect(held.serveUrl).toBe('https://serve.example.test')
    expect(held.tokenHash).toBe(STORED_HASH)
    expect(cipher.decrypt(held.sealedToken ?? '')).toBe('stored-token')
    expect(held.state).toBe('running')
    expect(held.wakeFailedAt).toBeNull()
    expect(held.lastActivityAt.getTime()).toBeGreaterThan(Date.now() - 10_000)
  })

  it('boots a workspace-owned row without injecting its Vercel token and flags it API-provisioned', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot, credentials: { workspaceOwned: true } }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls[0]?.credentials).toEqual({ token: 'vercel-token', teamId: 'team-1', projectId: 'proj-1' })
    expect(calls[0]?.injectVercelCredentials).toBe(false)
    expect(calls[0]?.environment).toEqual({ ATLAS_API_PROVISIONED: '1' })
  })

  it('keeps injecting credentials for a legacy BYO row', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot, credentials: { workspaceOwned: false } }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls[0]).not.toHaveProperty('injectVercelCredentials')
    expect(calls[0]).not.toHaveProperty('environment')
  })

  it('a sandbox Vercel had to create fresh runs under a newly minted token and drops the dead record', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot({ created: true })

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    const fresh = calls[0]?.freshToken ?? ''
    expect(fresh).toMatch(/^[0-9a-f]{64}$/)
    const held = await readSandbox()
    expect(held.tokenHash).toBe(hashSessionToken(fresh))
    expect(cipher.decrypt(held.sealedToken ?? '')).toBe(fresh)
    expect(held.runtimeCheckpointRevision).toBeNull()
  })

  it('hands the boot no resume token when the stored one does not decrypt', async () => {
    await seedParkedSandbox({ sealedToken: 'not-a-sealed-token' })
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls[0]?.resumeToken).toBeUndefined()
  })

  it('ignores sandboxes whose mirrored record is serving, even if the legacy column says parked', async () => {
    const serving = mirroredRecord({ phase: ERuntimePhase.Serving })
    await seedParkedSandbox({ runtimeCheckpoint: serving, runtimeCheckpointRevision: serving.revision })
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('never wakes a sandbox still parking', async () => {
    const parking = mirroredRecord({ phase: ERuntimePhase.Parking })
    await seedParkedSandbox({ runtimeCheckpoint: parking, runtimeCheckpointRevision: parking.revision })
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

  it('coalesces an event storm into one boot per thread', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()
    const wake = serviceWith({ boot })

    for (let i = 0; i < 6; i += 1) {
      wake.notifyEvent(PR_EVENT)
      await settleLookups()
      await vi.advanceTimersByTimeAsync(1_000)
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

  it('boots a release pin with no release artifact without any HEAD-check, leaving the launcher to decide', async () => {
    const releaseCheck = releaseArtifactCheck(false)
    vi.stubGlobal('fetch', releaseCheck)
    await seedParkedSandbox({ serveVersion: '9.9.9' })
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(releaseCheck).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.serveVersion).toBe('9.9.9')
    expect((await readSandbox()).wakeFailedAt).toBeNull()
  })

  it('boots the pinned version exactly while GitHub is unreachable', async () => {
    const offline = vi.fn(async () => Promise.reject(new Error('offline')))
    vi.stubGlobal('fetch', offline)
    await seedParkedSandbox({ serveVersion: '1.92.6' })
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(offline).not.toHaveBeenCalled()
    expect(calls[0]?.serveVersion).toBe('1.92.6')
    expect((await readSandbox()).wakeFailedAt).toBeNull()
  })

  it('boots latest only for a row no released client ever pinned', async () => {
    await seedParkedSandbox({ serveVersion: null })
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls[0]?.serveVersion).toBeUndefined()
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

  describe('settle', () => {
    it('boots a debounced target immediately, exactly once, and the timer never fires a second boot', async () => {
      await seedParkedSandbox()
      await seedSubscription()
      const { boot, calls } = fakeBoot()
      const wake = serviceWith({ boot })

      const timersBefore = vi.getTimerCount()

      wake.notifyEvent(PR_EVENT)
      await settleLookups()
      await vi.advanceTimersByTimeAsync(1)
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
      await vi.advanceTimersByTimeAsync(0)
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
})
