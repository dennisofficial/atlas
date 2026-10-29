import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { registerPodChild } from '../sandboxes/pod-child'
import { podSessionOf } from './session-of-thread'
import { inertSignals } from './thread-signals.fixture'
import { ThreadArchiveService } from './thread-archive.service'
import { ThreadsHistoryService } from './threads-history.service'

describe('session-owned state', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
    await seedThreadRow({ id: 'brn_main', userId: USER_A, workspace: '/w', repo: 'acme/app' })
    await seedSandboxRow({ threadId: 'brn_main' })
    await registerPodChild({
      rootThreadId: 'brn_main',
      userId: USER_A,
      input: { threadId: 'brn_mate', spawnedBy: 'brn_main', agentType: 'teammate', title: 'mate' },
      signals: inertSignals(),
    })
  })

  it('a teammate session falls back to its manager sandbox', async () => {
    const mate = await db.orm.public.Thread.where({ id: 'brn_mate' }).all().firstOrThrow()
    expect(mate.sessionId).not.toBe('ses_brn_main')
    expect(await podSessionOf({ reader: db, threadId: 'brn_mate' })).toBe('ses_brn_main')
    const session = await db.orm.public.Session.where({ id: mate.sessionId }).all().firstOrThrow()
    expect(session).toMatchObject({
      managedBySessionId: 'ses_brn_main',
      workspace: '/w',
      repo: 'acme/app',
      title: 'mate',
      mainThreadId: 'brn_mate',
    })
  })

  it('archiving writes to the session, not the thread', async () => {
    const dispatch = { dispatch: async () => ({ runId: 'r' }) }
    const archive = new ThreadArchiveService(dispatch, inertSignals())
    await archive.setArchived({ userId: USER_A, threadId: 'brn_main', archived: true })

    const session = await db.orm.public.Session.where({ id: 'ses_brn_main' }).all().firstOrThrow()
    expect(session.archivedAt).toBeInstanceOf(Date)
  })

  it('a fork creates a new session copying placement, unarchived', async () => {
    await db.orm.public.Session.where({ id: 'ses_brn_main' }).update({ archivedAt: new Date() })
    const forked = await new ThreadsHistoryService(inertSignals()).fork({
      userId: USER_A,
      threadId: 'brn_main',
      draft: { seq: 0, mode: 'reference', title: 'forked' },
    })

    expect(forked.sessionId).not.toBe('ses_brn_main')
    const session = await db.orm.public.Session.where({ id: forked.sessionId ?? '' })
      .all()
      .firstOrThrow()
    expect(session).toMatchObject({
      workspace: '/w',
      repo: 'acme/app',
      title: 'forked',
      archivedAt: null,
      pinnedAt: null,
      mainThreadId: forked.id,
      managedBySessionId: null,
    })
  })
})
