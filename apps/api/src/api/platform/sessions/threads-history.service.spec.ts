import { BadRequestException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { seedOrganization, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  eventsOf,
  seedEventRow,
  seedThreadRow,
  seedUsers,
  threadById,
  USER_A,
} from '../../../../test/session-seed'
import { ThreadsHistoryService } from './threads-history.service'

const seedThreadWithEvents = async (types: string[]): Promise<void> => {
  await seedThreadRow({ id: 'brn_one', head: types.length })
  for (const [index, type] of types.entries()) {
    await seedEventRow({
      id: `evt_${index + 1}`,
      threadId: 'brn_one',
      seq: index + 1,
      type,
      body: JSON.stringify({ type }),
    })
  }
}

describe('ThreadsHistoryService', () => {
  useTestDatabase()
  let service: ThreadsHistoryService

  beforeEach(async () => {
    await seedUsers(USER_A)
    service = new ThreadsHistoryService()
  })

  it('rewind drops events past the target and resets the head', async () => {
    await seedThreadWithEvents(['user-said', 'assistant-said', 'user-said', 'assistant-said'])

    await service.rewind({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { toSeq: 2 },
    })

    expect((await eventsOf('brn_one')).map((row) => row.seq)).toEqual([1, 2])
    expect((await threadById('brn_one'))?.head).toBe(2)
  })

  it('rewind deletes unreferenced cut agents but only unlinks referenced ones', async () => {
    await seedThreadWithEvents(['user-said', 'assistant-said'])
    await seedThreadRow({ id: 'brn_agent_lost', spawnerThreadId: 'brn_one', agentType: 'explore' })
    await seedThreadRow({ id: 'brn_agent_kept', spawnerThreadId: 'brn_one', agentType: 'explore' })
    await seedThreadRow({
      id: 'brn_grandchild',
      spawnerThreadId: 'brn_agent_kept',
      agentType: 'builder',
    })

    await service.rewind({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { toSeq: 1, cutAgents: ['brn_agent_lost', 'brn_agent_kept'] },
    })

    const ids = (await db.orm.public.Thread.all()).map((row) => row.id)
    expect(ids).not.toContain('brn_agent_lost')
    const kept = await threadById('brn_agent_kept')
    expect(kept).toMatchObject({ spawnerThreadId: null, agentType: null })
  })

  it('compact keeps the rows and appends the watermark past the head', async () => {
    await seedThreadWithEvents(['user-said', 'assistant-said', 'user-said'])

    const result = await service.compact({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { anchor: 'prefix', fromSeq: 1, throughSeq: 2, summary: 'the beginning' },
    })

    expect(result.replaced).toBe(2)
    const stored = await eventsOf('brn_one')
    expect(stored).toHaveLength(4)
    const watermark = stored.find((row) => row.type === 'history-compacted')
    expect(watermark?.seq).toBe(4)
    expect((await threadById('brn_one'))?.head).toBe(4)
  })

  it('summarise deletes the covered rows but spares the surviving kinds', async () => {
    await seedThreadWithEvents(['user-said', 'context-loaded', 'assistant-said'])

    const result = await service.summarise({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { anchor: 'prefix', fromSeq: 1, throughSeq: 3, summary: 'everything' },
    })

    expect(result.replaced).toBe(2)
    const stored = await eventsOf('brn_one')
    expect(stored.map((row) => row.type)).toEqual(['context-loaded', 'history-compacted'])
    const watermark = stored.find((row) => row.type === 'history-compacted')
    expect(watermark?.seq).toBe(3)
    expect((await threadById('brn_one'))?.head).toBe(3)
  })

  it('fork reference links the parent without copying rows', async () => {
    await seedThreadWithEvents(['user-said', 'assistant-said', 'user-said'])

    const forked = await service.fork({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { seq: 2, mode: 'reference' },
    })

    expect(forked).toMatchObject({
      head: 2,
      parent: { threadId: 'brn_one', forkSeq: 2 },
      forkMode: 'reference',
    })
    expect(await eventsOf(forked.id)).toHaveLength(0)
  })

  it('fork copy duplicates the rows up to the fork point with fresh ids', async () => {
    await seedThreadWithEvents(['user-said', 'assistant-said', 'user-said'])

    const forked = await service.fork({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { seq: 2, mode: 'copy' },
    })

    const copied = await eventsOf(forked.id)
    expect(copied.map((row) => row.seq)).toEqual([1, 2])
    // Fresh ids are `evt_<uuid>`, so a prefix check against the seeds flakes whenever the uuid
    // opens with a colliding character; only reuse of the exact seeded ids proves a copy failed.
    expect(copied.every((row) => !['evt_1', 'evt_2'].includes(row.id))).toBe(true)
    expect(copied.every((row) => row.userId === USER_A)).toBe(true)
  })

  it('fork carries the source thread project and owner organization', async () => {
    await seedOrganization({ db, id: 'org-1', memberIds: [USER_A] })
    await db.orm.public.Project.create({
      id: 'prj-1',
      name: 'prj-1',
      organizationId: 'org-1',
      createdById: USER_A,
    })
    await seedThreadRow({ id: 'brn_one', head: 0, projectId: 'prj-1', organizationId: 'org-1' })

    const forked = await service.fork({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { seq: 0, mode: 'reference' },
    })

    expect((await threadById(forked.id))?.organizationId).toBe('org-1')
    expect((await threadById(forked.id))?.projectId).toBe('prj-1')
  })

  it('fork past the head is refused', async () => {
    await seedThreadWithEvents(['user-said'])

    await expect(
      service.fork({ userId: USER_A, threadId: 'brn_one', draft: { seq: 5, mode: 'copy' } }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
