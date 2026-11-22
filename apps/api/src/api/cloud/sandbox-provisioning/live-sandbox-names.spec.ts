import { db } from '@dltech/atlas-db'
import { controlTxOf, lockPodRetireIn } from '@dltech/atlas-control/postgres'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { PG_PRESENCE_LOCK_NAMESPACE } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'
import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { sandboxNameOf } from '../../../agent'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import {
  liveSandboxNames,
  podStillRetirable,
  podStillRetirableIn,
  retirableSandboxNames,
  v2Pods,
} from './live-sandbox-names'

const NOW = new Date('2026-11-10T06:00:00Z')
const hoursBefore = (hours: number): Date => new Date(NOW.getTime() - hours * 60 * 60 * 1_000)

const v2Session = async (args: {
  id: string
  podSessionId?: string
  archivedAt?: Date
}): Promise<void> => {
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
    ...(args.archivedAt === undefined ? {} : { archivedAt: args.archivedAt }),
    createdAt: at,
  })
}

const v2Lease = async (args: { sessionId: string; holderHostId: number | null }): Promise<void> => {
  await db.orm.v2.V2Lease.create({
    sessionId: args.sessionId,
    epoch: 0,
    holderHostId: args.holderHostId,
    wantsHolder: false,
    attempts: 0,
    retryAfter: null,
  })
}

const openSandboxRun = async (args: { id: string; sessionId: string }): Promise<void> => {
  await db.orm.v2.V2SandboxRun.create({
    id: args.id,
    sessionId: args.sessionId,
    userId: 'user-a',
    provider: 'agent37',
    sandboxInstanceId: null,
    vcpus: 2,
    memoryGb: 4,
    diskGb: 20,
    startedAt: hoursBefore(2),
    endedAt: null,
    activeCpuMs: null,
    cpuBaselineMs: null,
    awakeMs: null,
    costUsd: null,
    costSource: null,
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

  it('retires a v2 pod only once every session on it is archived past the grace', async () => {
    await v2Session({ id: 'v2-fresh', archivedAt: hoursBefore(1) })
    await v2Session({ id: 'v2-a', archivedAt: hoursBefore(25) })
    await v2Session({ id: 'v2-b', podSessionId: 'v2-a', archivedAt: hoursBefore(25) })
    await v2Session({ id: 'v2-shared', archivedAt: hoursBefore(25) })
    await v2Session({ id: 'v2-peer-fresh', podSessionId: 'v2-shared', archivedAt: hoursBefore(1) })
    await v2Session({ id: 'v2-live' })

    const { live, retirable, sessionIdsByPod } = await v2Pods({ now: NOW })

    expect(retirable.has('v2-a')).toBe(true)
    expect(retirable.has('v2-fresh')).toBe(false)
    expect(retirable.has('v2-shared')).toBe(false)
    expect(live.has('v2-live')).toBe(true)
    expect(live.has('v2-fresh')).toBe(true)
    expect(live.has('v2-shared')).toBe(true)
    expect(sessionIdsByPod.get('v2-a')).toEqual(['v2-a', 'v2-b'])
  })

  it('says a pod is still retirable only while every session on it stays archived', async () => {
    await v2Session({ id: 'v2-a', archivedAt: hoursBefore(25) })
    await v2Session({ id: 'v2-b', podSessionId: 'v2-a', archivedAt: hoursBefore(25) })
    await v2Session({ id: 'v2-fresh', podSessionId: 'v2-fresh', archivedAt: hoursBefore(1) })

    expect(await podStillRetirable({ podSessionId: 'v2-a', now: NOW })).toBe(true)
    expect(await podStillRetirable({ podSessionId: 'v2-unknown', now: NOW })).toBe(true)
    expect(await podStillRetirable({ podSessionId: 'v2-fresh', now: NOW })).toBe(false)

    await db.orm.v2.V2Session.where({ id: 'v2-b' }).updateAndCount({ archivedAt: null })
    expect(await podStillRetirable({ podSessionId: 'v2-a', now: NOW })).toBe(false)
  })

  it('keeps the pod of an archived session live while a sandbox run on it is still open', async () => {
    await v2Session({ id: 'v2-running', archivedAt: hoursBefore(25) })
    await openSandboxRun({ id: 'run-1', sessionId: 'v2-running' })

    const { live, retirable } = await v2Pods({ now: NOW })

    expect(live.has('v2-running')).toBe(true)
    expect(retirable.has('v2-running')).toBe(false)
    expect(await podStillRetirable({ podSessionId: 'v2-running', now: NOW })).toBe(false)
  })

  it('keeps the pod of an archived session live while a present host holds its lease', async () => {
    await v2Session({ id: 'v2-held', archivedAt: hoursBefore(25) })
    await v2Lease({ sessionId: 'v2-held', holderHostId: 7 })

    await db.transaction(async (tx) => {
      await tx.query(
        tx.raw
          .sql`SELECT pg_advisory_xact_lock(${PG_PRESENCE_LOCK_NAMESPACE}::int, 7::int)::text AS "held"`
          .returnsRow({ held: 'pg/text@1' })
          .build(),
      )
      const { live, retirable } = await v2Pods({ now: NOW })

      expect(live.has('v2-held')).toBe(true)
      expect(retirable.has('v2-held')).toBe(false)
      expect(await podStillRetirable({ podSessionId: 'v2-held', now: NOW })).toBe(false)
    })
  })

  it('retires the pod of an archived session whose lease has no host behind it', async () => {
    await v2Session({ id: 'v2-stale', archivedAt: hoursBefore(25) })
    await v2Lease({ sessionId: 'v2-stale', holderHostId: 7 })

    const { retirable } = await v2Pods({ now: NOW })

    expect(retirable.get('v2-stale')).toBe(hoursBefore(25).getTime())
  })

  it('makes an unarchive wait for a held retirement, and the recheck then sees the session live', async () => {
    await v2Session({ id: 'v2-fenced', archivedAt: hoursBefore(25) })
    const holding = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const retirement = db.transaction(async (tx) => {
      await lockPodRetireIn({ tx, podSessionId: 'v2-fenced' })
      holding.resolve()
      await release.promise
      return podStillRetirableIn({ tx, podSessionId: 'v2-fenced', now: NOW })
    })
    await holding.promise

    const unarchive = db.transaction((tx) =>
      controlTxOf(tx).setSessionArchived({ sessionId: 'v2-fenced', archivedAt: null }),
    )
    const raced = await Promise.race([
      unarchive.then(() => 'done'),
      Bun.sleep(100).then(() => 'waiting'),
    ])

    expect(raced).toBe('waiting')
    release.resolve()
    expect(await retirement).toBe(true)
    await unarchive
    expect(await podStillRetirable({ podSessionId: 'v2-fenced', now: NOW })).toBe(false)
  })
})
