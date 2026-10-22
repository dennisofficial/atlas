import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  cipher,
  fakeBoot,
  flushDebounce,
  PR_EVENT,
  readSandbox,
  releaseArtifactCheck,
  seedParkedSandbox,
  STORED_HASH,
  seedSubscription,
  serviceWith,
} from '../../../../test/github-sandbox-wake-fixture'
import { hashSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'

describe('GithubSandboxWakeService resume', () => {
  useTestDatabase()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    unstubAllGlobals()
    vi.useRealTimers()
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
    expect(calls[0]?.credentials).toEqual({
      token: 'vercel-token',
      teamId: 'team-1',
      projectId: 'proj-1',
    })
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

    serviceWith({ boot, credentials: { ownerCredential: true } }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls[0]?.credentials).toEqual({
      token: 'vercel-token',
      teamId: 'team-1',
      projectId: 'proj-1',
    })
    expect(calls[0]?.injectVercelCredentials).toBe(false)
    expect(calls[0]?.environment).toEqual({ ATLAS_API_PROVISIONED: '1' })
  })

  it('keeps injecting credentials for a legacy BYO row', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot, credentials: { ownerCredential: false } }).notifyEvent(PR_EVENT)
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

  it('boots a release pin with no release artifact without any HEAD-check, leaving the launcher to decide', async () => {
    const releaseCheck = releaseArtifactCheck(false)
    stubGlobal('fetch', releaseCheck)
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
    stubGlobal('fetch', offline)
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
})
