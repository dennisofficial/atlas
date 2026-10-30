import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { recordingSignals } from '../sessions/thread-signals.fixture'
import { registerPodChild } from './pod-child'

const register = (input: {
  threadId: string
  spawnedBy: string
  agentType?: string
  title?: string
}) =>
  registerPodChild({
    rootThreadId: 'thr-1',
    userId: 'usr-1',
    input: { agentType: 'explore', ...input },
    signals: recordingSignals().signals,
  })

describe('registerPodChild', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('usr-1', 'usr-2')
    await seedThreadRow({
      id: 'thr-1',
      userId: 'usr-1',
      workspace: '/workspace',
      repo: 'acme/app',
      executionLocation: 'cloud',
    })
  })

  it('creates the child row under the spawner with the root placement', async () => {
    const reply = await register({ threadId: 'thr-c1', spawnedBy: 'thr-1' })

    const row = await db.orm.public.Thread.where({ id: 'thr-c1' }).first()
    expect(reply).toEqual({ head: 0 })
    expect(row).toMatchObject({
      userId: 'usr-1',
      spawnerThreadId: 'thr-1',
      agentType: 'explore',
      sessionId: 'ses_thr-1',
    })
    expect(await db.orm.public.Session.where({ userId: 'usr-1' }).all()).toHaveLength(1)
  })

  it('is idempotent and reports the stored head', async () => {
    await register({ threadId: 'thr-c1', spawnedBy: 'thr-1' })
    await db.orm.public.Thread.where({ id: 'thr-c1' }).update({ head: 4 })

    expect(await register({ threadId: 'thr-c1', spawnedBy: 'thr-1' })).toEqual({ head: 4 })
  })

  it('refuses a row registered under a different spawner with 409', async () => {
    await seedThreadRow({ id: 'thr-c2', userId: 'usr-1', spawnerThreadId: 'thr-1' })
    await register({ threadId: 'thr-c1', spawnedBy: 'thr-1' })

    await expect(register({ threadId: 'thr-c1', spawnedBy: 'thr-c2' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('registers a descendant of a child and refuses a spawner outside the family', async () => {
    await register({ threadId: 'thr-c1', spawnedBy: 'thr-1' })
    await seedThreadRow({ id: 'thr-x', userId: 'usr-1' })

    expect(await register({ threadId: 'thr-c2', spawnedBy: 'thr-c1' })).toEqual({ head: 0 })
    await expect(register({ threadId: 'thr-c3', spawnedBy: 'thr-x' })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('titles a new teammate session from the registration', async () => {
    await register({ threadId: 'thr-m1', spawnedBy: 'thr-1', agentType: 'teammate', title: 'mate' })

    const thread = await db.orm.public.Thread.where({ id: 'thr-m1' }).first()
    const session = await db.orm.public.Session.where({ id: thread?.sessionId ?? '' }).first()
    expect(session?.title).toBe('mate')
  })

  it('backfills an untitled teammate session on re-registration without overwriting a title', async () => {
    await register({ threadId: 'thr-m1', spawnedBy: 'thr-1', agentType: 'teammate' })
    const thread = await db.orm.public.Thread.where({ id: 'thr-m1' }).first()
    const sessionTitle = async () =>
      (await db.orm.public.Session.where({ id: thread?.sessionId ?? '' }).first())?.title

    expect(await sessionTitle()).toBeNull()
    await register({ threadId: 'thr-m1', spawnedBy: 'thr-1', agentType: 'teammate', title: 'mate' })
    expect(await sessionTitle()).toBe('mate')
    await register({
      threadId: 'thr-m1',
      spawnedBy: 'thr-1',
      agentType: 'teammate',
      title: 'other',
    })
    expect(await sessionTitle()).toBe('mate')
  })

  it('refuses to adopt a thread row owned by another user', async () => {
    await seedThreadRow({ id: 'thr-c1', userId: 'usr-2', spawnerThreadId: 'thr-1' })

    await expect(register({ threadId: 'thr-c1', spawnedBy: 'thr-1' })).rejects.toMatchObject({
      status: 409,
    })
  })
})
