import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb, seedCloudSandbox } from '../../../../test/fake-github-db'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { PARK_WAKE_WINDOW_MS } from './github-delivery-routing'
import {
  GithubSandboxWakeService,
  WAKE_DEBOUNCE_MS,
  type SandboxWakeBoot,
  type WakeBootArgs,
} from './github-sandbox-wake.service'

const fake = fakeGithubDb()

const SECRETS_KEY = 'a'.repeat(64)

const pastIso = (ms: number): string => new Date(Date.now() - ms).toISOString()

function seedSubscription(args: { userId?: string; threadId?: string | null }): void {
  fake.subscriptions.push({
    id: `sub-${fake.subscriptions.length + 1}`,
    userId: args.userId ?? 'usr-1',
    repoFullName: 'compai/app',
    prNumber: 42,
    branch: '',
    pollBacked: false,
    expiresAt: new Date(Date.now() - 60_000),
    threadId: args.threadId === undefined ? 'thr-1' : args.threadId,
    sandboxId: null,
    createdAt: new Date(),
  })
}

function serviceWith(args: {
  boot: SandboxWakeBoot
  env?: Partial<Record<'VERCEL_TOKEN' | 'VERCEL_TEAM_ID' | 'VERCEL_PROJECT_ID', string>>
}): GithubSandboxWakeService {
  const env = {
    get: (key: string) =>
      ({
        VERCEL_TOKEN: 'vercel-token',
        VERCEL_TEAM_ID: 'team-1',
        VERCEL_PROJECT_ID: 'proj-1',
        SANDBOX_IMAGE: 'atlas-sandbox:latest',
        ATLAS_CLOUD_URL: 'https://api.byatlas.io',
        ...args.env,
      })[key],
  } as unknown as EnvService
  const cipher = new SecretCipherService({
    get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? SECRETS_KEY : undefined),
  } as unknown as EnvService)
  return new GithubSandboxWakeService(env, cipher, args.boot)
}

function fakeBoot(): { boot: SandboxWakeBoot; calls: WakeBootArgs[] } {
  const calls: WakeBootArgs[] = []
  return {
    calls,
    boot: {
      boot: async (bootArgs: WakeBootArgs) => {
        calls.push(bootArgs)
        return { serveUrl: 'https://serve.example.test' }
      },
    },
  }
}

async function flushDebounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(WAKE_DEBOUNCE_MS + 1)
  await vi.advanceTimersByTimeAsync(0)
}

describe('GithubSandboxWakeService', () => {
  beforeEach(() => {
    fake.reset()
    vi.useFakeTimers()
  })

  it('boots a parked sandbox inside the wake window and updates its row', async () => {
    seedSubscription({})
    seedCloudSandbox({
      id: 'sbx-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      sandboxId: 'vsbx-1',
      name: 'atlas-sandbox-abc',
      region: 'iad1',
      state: 'parked',
      lastActivityAt: pastIso(60_000),
      driveName: 'atlas-drive-abc',
      serveVersion: '1.92.6',
    })
    const { boot, calls } = fakeBoot()
    const wake = serviceWith({ boot })

    wake.notifyEvent({ userId: 'usr-1', repoFullName: 'compai/app', prNumber: 42 })
    await flushDebounce()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      name: 'atlas-sandbox-abc',
      driveName: 'atlas-drive-abc',
      threadId: 'thr-1',
      image: 'atlas-sandbox:latest',
      cloudUrl: 'https://api.byatlas.io',
      serveVersion: '1.92.6',
    })
    expect(calls[0]?.credentials).toEqual({
      token: 'vercel-token',
      teamId: 'team-1',
      projectId: 'proj-1',
    })
    expect(calls[0]?.token).toMatch(/^[0-9a-f]{64}$/)

    const row = fake.cloudSandboxes[0]
    expect(row?.state).toBe('running')
    expect(row?.serveUrl).toBe('https://serve.example.test')
    expect(row?.sealedToken).toEqual(expect.any(String))
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.tokenHash).not.toBe(calls[0]?.token)
    expect(Date.parse(row?.lastActivityAt ?? '')).toBeGreaterThan(Date.now() - 10_000)
  })

  it('ignores running sandboxes', async () => {
    seedSubscription({})
    seedCloudSandbox({
      id: 'sbx-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      sandboxId: 'vsbx-1',
      name: 'atlas-sandbox-abc',
      region: 'iad1',
      state: 'running',
      lastActivityAt: pastIso(60_000),
    })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent({ userId: 'usr-1', repoFullName: 'compai/app', prNumber: 42 })
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('ignores parked sandboxes whose last activity fell outside the wake window', async () => {
    seedSubscription({})
    seedCloudSandbox({
      id: 'sbx-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      sandboxId: 'vsbx-1',
      name: 'atlas-sandbox-abc',
      region: 'iad1',
      state: 'parked',
      lastActivityAt: pastIso(PARK_WAKE_WINDOW_MS + 60_000),
    })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent({ userId: 'usr-1', repoFullName: 'compai/app', prNumber: 42 })
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('ignores subscriptions without a thread link', async () => {
    seedSubscription({ threadId: null })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent({ userId: 'usr-1', repoFullName: 'compai/app', prNumber: 42 })
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('coalesces an event storm into one boot per thread', async () => {
    seedSubscription({})
    seedCloudSandbox({
      id: 'sbx-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      sandboxId: 'vsbx-1',
      name: 'atlas-sandbox-abc',
      region: 'iad1',
      state: 'parked',
      lastActivityAt: pastIso(60_000),
    })
    const { boot, calls } = fakeBoot()
    const wake = serviceWith({ boot })

    for (let i = 0; i < 6; i += 1) {
      wake.notifyEvent({ userId: 'usr-1', repoFullName: 'compai/app', prNumber: 42 })
      await vi.advanceTimersByTimeAsync(1_000)
    }
    await flushDebounce()

    expect(calls).toHaveLength(1)
  })

  it('boots each distinct thread once', async () => {
    seedSubscription({ threadId: 'thr-1' })
    seedSubscription({ threadId: 'thr-2' })
    for (const threadId of ['thr-1', 'thr-2']) {
      seedCloudSandbox({
        id: `sbx-${threadId}`,
        threadId,
        userId: 'usr-1',
        sandboxId: `vsbx-${threadId}`,
        name: `atlas-sandbox-${threadId}`,
        region: 'iad1',
        state: 'parked',
        lastActivityAt: pastIso(60_000),
      })
    }
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent({ userId: 'usr-1', repoFullName: 'compai/app', prNumber: 42 })
    await flushDebounce()

    expect(calls).toHaveLength(2)
    expect(new Set(calls.map((call) => call.threadId))).toEqual(new Set(['thr-1', 'thr-2']))
  })

  it('logs a boot failure and leaves the row parked', async () => {
    seedSubscription({})
    seedCloudSandbox({
      id: 'sbx-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      sandboxId: 'vsbx-1',
      name: 'atlas-sandbox-abc',
      region: 'iad1',
      state: 'parked',
      lastActivityAt: pastIso(60_000),
    })
    const boot: SandboxWakeBoot = {
      boot: async () => {
        throw new Error('vercel is down')
      },
    }
    const wake = serviceWith({ boot })

    wake.notifyEvent({ userId: 'usr-1', repoFullName: 'compai/app', prNumber: 42 })
    await flushDebounce()

    expect(fake.cloudSandboxes[0]?.state).toBe('parked')
  })

  it('derives the drive name from the thread when the row does not carry one', async () => {
    seedSubscription({})
    seedCloudSandbox({
      id: 'sbx-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      sandboxId: 'vsbx-1',
      name: 'atlas-sandbox-abc',
      region: 'iad1',
      state: 'parked',
      lastActivityAt: pastIso(60_000),
      driveName: null,
      serveVersion: null,
    })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent({ userId: 'usr-1', repoFullName: 'compai/app', prNumber: 42 })
    await flushDebounce()

    expect(calls[0]?.driveName).toMatch(/^atlas-drive-[0-9a-f]{24}$/)
    expect(calls[0]?.serveVersion).toBeUndefined()
  })
})
