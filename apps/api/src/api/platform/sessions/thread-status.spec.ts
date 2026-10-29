import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  seedSandboxRow,
  seedThreadRow,
  seedUsers,
  STAMP,
  USER_A,
  USER_B,
} from '../../../../test/session-seed'
import { inertSignals } from './thread-signals.fixture'
import { threadStatuses } from './thread-status'
import { ThreadsService } from './threads.service'

const RUNNING = { state: 'running', serveUrl: 'https://serve.example' }

describe('thread status assembly', () => {
  useTestDatabase()
  let service: ThreadsService

  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
    service = new ThreadsService(inertSignals())
  })

  const statusOf = async (viewerId = USER_A) => {
    const row = await db.orm.public.Thread.where({ id: 'thr-1' }).first()
    if (row === null) throw new Error('missing thread')
    const session = await db.orm.public.Session.where({ id: row.sessionId }).all().firstOrThrow()
    return (await threadStatuses({ rows: [{ thread: row, session }], viewerId })).get('thr-1')
  }

  it('local threads with no sandbox row report podState none and no activity', async () => {
    await seedThreadRow({ id: 'thr-1', working: true, awaiting: 'approval' })
    expect(await statusOf()).toEqual({
      working: false,
      awaiting: null,
      lastOutcome: null,
      podState: 'none',
      lastAssistantSeq: 0,
      readSeq: null,
    })
  })

  it('reports working and awaiting only while the pod is running', async () => {
    await seedThreadRow({
      id: 'thr-1',
      working: true,
      awaiting: 'input',
      lastOutcome: 'completed',
      lastAssistantSeq: 4,
      activityAt: STAMP,
    })
    await seedSandboxRow({ threadId: 'thr-1', ...RUNNING })
    expect(await statusOf()).toMatchObject({
      working: true,
      awaiting: 'input',
      lastOutcome: 'completed',
      podState: 'running',
      lastAssistantSeq: 4,
    })

    await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
      state: 'parked',
    })
    expect(await statusOf()).toMatchObject({
      working: false,
      awaiting: null,
      lastOutcome: 'completed',
      podState: 'parked',
    })
  })

  it('derives failed from the latest boot step', async () => {
    await seedThreadRow({ id: 'thr-1' })
    await db.orm.public.SandboxBootStep.create({
      sessionId: 'ses_thr-1',
      step: 'create',
      state: 'error',
      error: 'boom',
      at: STAMP,
    })
    expect(await statusOf()).toMatchObject({ podState: 'failed' })
  })

  it('maps unknown stored strings to null', async () => {
    await seedThreadRow({
      id: 'thr-1',
      working: true,
      awaiting: 'bogus',
      lastOutcome: 'weird',
    })
    await seedSandboxRow({ threadId: 'thr-1', ...RUNNING })
    expect(await statusOf()).toMatchObject({
      awaiting: null,
      lastOutcome: null,
      working: true,
    })
  })

  it("exposes only the viewer's own read marker", async () => {
    await seedThreadRow({ id: 'thr-1' })
    await db.orm.public.ThreadRead.create({
      userId: USER_A,
      threadId: 'thr-1',
      seq: 3,
      updatedAt: STAMP,
    })
    await db.orm.public.ThreadRead.create({
      userId: USER_B,
      threadId: 'thr-1',
      seq: 7,
      updatedAt: STAMP,
    })

    expect((await statusOf(USER_A))?.readSeq).toBe(3)
    expect((await statusOf(USER_B))?.readSeq).toBe(7)
    expect((await statusOf('user-c'))?.readSeq).toBeNull()
  })
})

describe('thread status on the wire', () => {
  useTestDatabase()

  it('find and list carry status for the viewer', async () => {
    await seedUsers(USER_A)
    await seedThreadRow({
      id: 'thr-1',
      workspace: '/repo',
      lastAssistantSeq: 2,
    })
    await db.orm.public.ThreadRead.create({
      userId: USER_A,
      threadId: 'thr-1',
      seq: 1,
      updatedAt: STAMP,
    })
    const service = new ThreadsService(inertSignals())
    const found = await service.find({ userId: USER_A, threadId: 'thr-1' })
    const [listed] = await service.list({ userId: USER_A, project: '/repo' })
    expect(found.status).toMatchObject({ lastAssistantSeq: 2, readSeq: 1 })
    expect(listed?.status).toEqual(found.status)
  })
})
