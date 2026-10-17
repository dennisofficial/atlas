import { ERuntimePhase } from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import {
  cipher,
  failingBoot,
  fake,
  fakeBoot,
  flushDebounce,
  mirroredRecord,
  pastIso,
  PR_EVENT,
  releaseArtifactCheck,
  seedParkedSandbox,
  seedSubscription,
  serviceWith,
} from '../../../../test/github-sandbox-wake-fixture'
import { hashSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { sandboxStateOf } from '../../platform/sandboxes/sandbox-lifecycle'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { PARK_WAKE_WINDOW_MS } from './github-delivery-routing'
import { WAKE_DEBOUNCE_MS, WAKE_FAILURE_BACKOFF_MS } from './github-sandbox-wake.service'

const row = () => {
  const held = fake.cloudSandboxes[0]
  if (held === undefined) throw new Error('no seeded sandbox row')
  return held as Parameters<typeof sandboxStateOf>[0] & typeof held
}

describe('GithubSandboxWakeService', () => {
  beforeEach(() => {
    fake.reset()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', releaseArtifactCheck(true))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resumes a parked sandbox with its stored token and leaves the token columns alone', async () => {
    seedSubscription()
    seedParkedSandbox({ serveVersion: '1.92.6' })
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
    expect(row().serveUrl).toBe('https://serve.example.test')
    expect(row().tokenHash).toBe('stored-hash')
    expect(cipher.decrypt(row().sealedToken ?? '')).toBe('stored-token')
    expect(row().state).toBe('running')
    expect(row().wakeFailedAt).toBeNull()
    expect(Date.parse(row().lastActivityAt)).toBeGreaterThan(Date.now() - 10_000)
  })

  it('a sandbox Vercel had to create fresh runs under a newly minted token and drops the dead record', async () => {
    seedSubscription()
    seedParkedSandbox()
    const { boot, calls } = fakeBoot({ created: true })

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    const fresh = calls[0]?.freshToken ?? ''
    expect(fresh).toMatch(/^[0-9a-f]{64}$/)
    expect(row().tokenHash).toBe(hashSessionToken(fresh))
    expect(cipher.decrypt(row().sealedToken ?? '')).toBe(fresh)
    expect(row().runtimeCheckpointRevision).toBeNull()
  })

  it('hands the boot no resume token when the stored one does not decrypt', async () => {
    seedSubscription()
    seedParkedSandbox({ sealedToken: 'not-a-sealed-token' })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls[0]?.resumeToken).toBeUndefined()
  })

  it('ignores sandboxes whose mirrored record is serving, even if the legacy column says parked', async () => {
    seedSubscription()
    const serving = mirroredRecord({ phase: ERuntimePhase.Serving })
    seedParkedSandbox({ runtimeCheckpoint: serving, runtimeCheckpointRevision: serving.revision })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('never wakes a sandbox still parking', async () => {
    seedSubscription()
    const parking = mirroredRecord({ phase: ERuntimePhase.Parking })
    seedParkedSandbox({ runtimeCheckpoint: parking, runtimeCheckpointRevision: parking.revision })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('falls back to the legacy state column for a row no serve has mirrored onto', async () => {
    seedSubscription()
    seedParkedSandbox({ runtimeCheckpoint: null, runtimeCheckpointRevision: null })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(1)
  })

  it('ignores parked sandboxes whose last activity fell outside the wake window', async () => {
    seedSubscription()
    seedParkedSandbox({ lastActivityAt: pastIso(PARK_WAKE_WINDOW_MS + 60_000) })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('ignores subscriptions without a thread link', async () => {
    seedSubscription({ threadId: null })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('coalesces an event storm into one boot per thread', async () => {
    seedSubscription()
    seedParkedSandbox()
    const { boot, calls } = fakeBoot()
    const wake = serviceWith({ boot })

    for (let i = 0; i < 6; i += 1) {
      wake.notifyEvent(PR_EVENT)
      await vi.advanceTimersByTimeAsync(1_000)
    }
    await flushDebounce()

    expect(calls).toHaveLength(1)
  })

  it('boots each distinct thread once', async () => {
    for (const threadId of ['thr-1', 'thr-2']) {
      seedSubscription({ threadId })
      const parked = mirroredRecord({ threadId, phase: ERuntimePhase.Parked })
      seedParkedSandbox({
        threadId,
        name: `atlas-sandbox-${threadId}`,
        runtimeCheckpoint: parked,
        runtimeCheckpointRevision: parked.revision,
      })
    }
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(new Set(calls.map((call) => call.threadId))).toEqual(new Set(['thr-1', 'thr-2']))
  })

  it('claims through wakeClaim before booting, so a second instance cannot double-boot', async () => {
    seedSubscription()
    seedParkedSandbox()
    const gate: { release: () => void } = { release: () => {} }
    const held = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    const first = fakeBoot({ held })
    const second = fakeBoot()

    serviceWith({ boot: first.boot }).notifyEvent(PR_EVENT)
    await vi.advanceTimersByTimeAsync(WAKE_DEBOUNCE_MS + 1)
    expect(first.calls).toHaveLength(1)
    expect(row().wakeClaim).toEqual(expect.any(String))
    expect(sandboxStateOf(row())).toBe(ESandboxState.Resuming)

    serviceWith({ boot: second.boot }).notifyEvent(PR_EVENT)
    await flushDebounce()
    expect(second.calls).toHaveLength(0)

    gate.release()
    await flushDebounce()
    expect(first.calls).toHaveLength(1)
  })

  it('a boot failure releases the claim and records wakeFailedAt for backoff', async () => {
    seedSubscription()
    seedParkedSandbox()

    serviceWith({ boot: failingBoot() }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(row().wakeClaim).toBeNull()
    expect(row().wakeFailedAt).toEqual(expect.any(String))
    expect(sandboxStateOf(row())).toBe(ESandboxState.Parked)
  })

  it('a recent wake failure backs the target off until the backoff window passes', async () => {
    seedSubscription()
    seedParkedSandbox({ wakeFailedAt: pastIso(60_000) })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()
    expect(calls).toHaveLength(0)

    row().wakeFailedAt = pastIso(WAKE_FAILURE_BACKOFF_MS + 60_000)
    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()
    expect(calls).toHaveLength(1)
  })

  it('fails the wake into backoff when the pinned version has no release artifact, never booting latest', async () => {
    vi.stubGlobal('fetch', releaseArtifactCheck(false))
    seedSubscription()
    seedParkedSandbox({ serveVersion: '9.9.9' })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
    expect(row().wakeClaim).toBeNull()
    expect(row().wakeFailedAt).toEqual(expect.any(String))
  })

  it('fails the wake when the release artifact cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    seedSubscription()
    seedParkedSandbox({ serveVersion: '1.92.6' })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
    expect(row().wakeFailedAt).toEqual(expect.any(String))
  })

  it('boots latest only for a row no released client ever pinned', async () => {
    seedSubscription()
    seedParkedSandbox({ serveVersion: null })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls[0]?.serveVersion).toBeUndefined()
  })

  it('skips the boot when serve mirrored a newer record during the debounce window', async () => {
    seedSubscription()
    seedParkedSandbox()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    const serving = mirroredRecord({ phase: ERuntimePhase.Serving, revision: 5 })
    row().runtimeCheckpoint = serving
    row().runtimeCheckpointRevision = serving.revision
    await flushDebounce()

    expect(calls).toHaveLength(0)
    expect(row().wakeClaim).toBeNull()
  })
})
