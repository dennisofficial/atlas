import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { v2Pods } from '@dltech/atlas-pods'
import { sandboxNameOf } from '../../../agent'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { liveSandboxNames, retirableSandboxNames } from './live-sandbox-names'
import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'

const NOW = new Date('2026-11-10T06:00:00Z')
const hoursBefore = (hours: number): Date => new Date(NOW.getTime() - hours * 60 * 60 * 1_000)

const v2Session = async (args: { id: string; podSessionId?: string }): Promise<void> => {
  const at = new Date('2026-11-09T00:00:00Z')
  await db.orm.v2.V2Session.create({
    id: args.id,
    userId: 'user-a',
    projectId: 'prj-1',
    mainThreadId: `thr_${args.id}`,
    nextInboxId: 1,
    modelRef: 'anthropic/claude-haiku-4-5',
    modelEffort: 'medium',
    modelFast: false,
    sandboxProvider: 'vercel',
    credentialSource: 'byok',
    ...(args.podSessionId === undefined ? {} : { podSessionId: args.podSessionId }),
    createdAt: at,
  })
}

describe('liveSandboxNames', () => {
  useTestDatabase()

  it('names every unarchived cloud session, and nothing archived', async () => {
    await seedUsers('user-a')
    await seedThreadRow({ id: 'thr-live', userId: 'user-a' })
    await seedThreadRow({ id: 'thr-archived', userId: 'user-a', archivedAt: hoursBefore(25) })

    const names = await liveSandboxNames({ now: NOW })

    expect(names.has(sandboxNameFor({ threadId: 'thr-live' }))).toBe(true)
    expect(names.has(sandboxNameFor({ threadId: 'thr-archived' }))).toBe(false)
  })

  it('keeps the name of a stopped sandbox live inside the archive grace', async () => {
    await seedUsers('user-a')
    await seedThreadRow({ id: 'thr-fresh', userId: 'user-a', archivedAt: hoursBefore(1) })
    await seedThreadRow({ id: 'thr-old', userId: 'user-a', archivedAt: hoursBefore(25) })
    for (const threadId of ['thr-fresh', 'thr-old']) {
      const at = new Date('2026-11-09T00:00:00Z')
      await db.orm.public.CloudSandbox.create({
        id: `sbx_${threadId}`,
        sessionId: `ses_${threadId}`,
        userId: 'user-a',
        sandboxId: '',
        name: sandboxNameFor({ threadId }),
        region: 'iad1',
        state: 'stopped',
        lastActivityAt: at,
        tokenHash: `hash_${threadId}`,
        createdAt: at,
        updatedAt: at,
      })
    }

    const names = await liveSandboxNames({ now: NOW })

    expect(names.has(sandboxNameFor({ threadId: 'thr-fresh' }))).toBe(true)
    expect(names.has(sandboxNameFor({ threadId: 'thr-old' }))).toBe(false)
  })

  it('keeps v2 pods out of the v1 live names, which are what the legacy sweep compares', async () => {
    await v2Session({ id: 'v2-root' })
    await v2Session({ id: 'v2-peer', podSessionId: 'v2-root' })

    const names = await liveSandboxNames({ now: NOW })

    expect(names.has(sandboxNameOf('v2-root'))).toBe(false)
    expect([...(await v2Pods({ now: NOW })).live]).toEqual(['v2-root'])
  })

  it('keeps a cloud sandbox archived inside the grace, and retires one archived past it', async () => {
    await seedUsers('user-a')
    await seedThreadRow({ id: 'thr-live', userId: 'user-a' })
    await seedThreadRow({ id: 'thr-fresh', userId: 'user-a', archivedAt: hoursBefore(1) })
    await seedThreadRow({ id: 'thr-old', userId: 'user-a', archivedAt: hoursBefore(25) })
    for (const threadId of ['thr-live', 'thr-fresh', 'thr-old']) {
      const at = new Date('2026-11-09T00:00:00Z')
      await db.orm.public.CloudSandbox.create({
        id: `sbx_${threadId}`,
        sessionId: `ses_${threadId}`,
        userId: 'user-a',
        sandboxId: '',
        name: `atlas-thread-${threadId}`,
        region: 'iad1',
        state: 'running',
        lastActivityAt: at,
        tokenHash: `hash_${threadId}`,
        createdAt: at,
        updatedAt: at,
      })
    }

    const retirable = await retirableSandboxNames({ now: NOW })

    expect(retirable.has('atlas-thread-thr-live')).toBe(false)
    expect(retirable.has('atlas-thread-thr-fresh')).toBe(false)
    expect(retirable.has('atlas-thread-thr-old')).toBe(true)
  })
})
