import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { registerPodChild } from '../sandboxes/pod-child'
import { inertSignals } from './thread-signals.fixture'
import { SessionsService } from './sessions.service'
import { ThreadsService } from './threads.service'

const MAIN = 'brn_main'
const PROJECT = 'prj_1'

const register = (input: { threadId: string; agentType: string }) =>
  registerPodChild({
    rootThreadId: MAIN,
    userId: USER_A,
    input: { ...input, spawnedBy: MAIN },
    signals: inertSignals(),
  })

describe('sessions and thread listing', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
    await db.orm.public.Project.create({
      id: PROJECT,
      ownerUserId: USER_A,
      name: 'p',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await seedThreadRow({
      id: MAIN,
      userId: USER_A,
      projectId: PROJECT,
      executionLocation: 'cloud',
    })
    await register({ threadId: 'brn_explore', agentType: 'explore' })
    await register({ threadId: 'brn_mate', agentType: 'teammate' })
  })

  it('threads.list returns main threads and teammates, never sub-agents', async () => {
    const listed = await new ThreadsService(inertSignals()).list({
      userId: USER_A,
      projectId: PROJECT,
    })

    expect(listed.map((thread) => thread.id).sort()).toEqual([MAIN, 'brn_mate'])
  })

  it('sessions.list returns one session with its teammate and no sub-agent', async () => {
    const listed = await new SessionsService().list({ userId: USER_A, projectId: PROJECT })

    expect(listed).toHaveLength(1)
    expect(listed[0]?.mainThread.id).toBe(MAIN)
    expect(listed[0]?.teammates.map((node) => node.mainThread.id)).toEqual(['brn_mate'])
    expect(listed[0]?.teammates[0]?.teammates).toEqual([])
  })
})
