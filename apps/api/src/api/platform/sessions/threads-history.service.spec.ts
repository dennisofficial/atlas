import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeSessionDb } = await import('../../../../test/fake-session-db.js')
  return { db: fakeSessionDb().db as unknown as PrismaClient }
})

import { fakeSessionDb, type FakeThreadRow } from '../../../../test/fake-session-db.js'
import { ThreadsHistoryService } from './threads-history.service'

const USER_A = 'user-a'

const fake = fakeSessionDb()

const threadRow = (partial: Partial<FakeThreadRow> & { id: string }): FakeThreadRow => ({
  title: null,
  head: 0,
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
  parentThreadId: null,
  forkSeq: null,
  forkMode: null,
  spawnerThreadId: null,
  agentType: null,
  workspace: null,
  repo: null,
  modelRef: null,
  modelEffort: null,
  executionLocation: null,
  userId: USER_A,
  ...partial,
})

const seedThreadWithEvents = async (types: string[]): Promise<void> => {
  fake.threads.push(threadRow({ id: 'brn_one', head: types.length }))
  types.forEach((type, index) => {
    fake.events.push({
      id: `evt_${index + 1}`,
      threadId: 'brn_one',
      seq: index + 1,
      runId: 'run_1',
      parentRunId: null,
      depth: 0,
      at: '2026-09-15T00:00:00.000Z',
      type,
      body: JSON.stringify({ type }),
      contextSlot: null,
      contextKey: null,
      contextDigest: null,
      userId: USER_A,
    })
  })
}

describe('ThreadsHistoryService', () => {
  let service: ThreadsHistoryService

  beforeEach(() => {
    fake.reset()
    service = new ThreadsHistoryService()
  })

  it('rewind drops events past the target and resets the head', async () => {
    await seedThreadWithEvents(['user-said', 'assistant-said', 'user-said', 'assistant-said'])

    await service.rewind({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { toSeq: 2 },
    })

    expect(fake.events.map((row) => row.seq)).toEqual([1, 2])
    expect(fake.threads[0]?.head).toBe(2)
  })

  it('rewind deletes unreferenced cut agents but only unlinks referenced ones', async () => {
    await seedThreadWithEvents(['user-said', 'assistant-said'])
    fake.threads.push(
      threadRow({ id: 'brn_agent_lost', spawnerThreadId: 'brn_one', agentType: 'explore' }),
      threadRow({ id: 'brn_agent_kept', spawnerThreadId: 'brn_one', agentType: 'explore' }),
      threadRow({ id: 'brn_grandchild', spawnerThreadId: 'brn_agent_kept', agentType: 'builder' }),
    )

    await service.rewind({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { toSeq: 1, cutAgents: ['brn_agent_lost', 'brn_agent_kept'] },
    })

    const ids = fake.threads.map((row) => row.id)
    expect(ids).not.toContain('brn_agent_lost')
    const kept = fake.threads.find((row) => row.id === 'brn_agent_kept')
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
    expect(fake.events).toHaveLength(4)
    const watermark = fake.events.find((row) => row.type === 'history-compacted')
    expect(watermark?.seq).toBe(4)
    expect(fake.threads[0]?.head).toBe(4)
  })

  it('summarise deletes the covered rows but spares the surviving kinds', async () => {
    await seedThreadWithEvents(['user-said', 'context-loaded', 'assistant-said'])

    const result = await service.summarise({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { anchor: 'prefix', fromSeq: 1, throughSeq: 3, summary: 'everything' },
    })

    expect(result.replaced).toBe(2)
    expect(fake.events.map((row) => row.type)).toEqual(['context-loaded', 'history-compacted'])
    const watermark = fake.events.find((row) => row.type === 'history-compacted')
    expect(watermark?.seq).toBe(3)
    expect(fake.threads[0]?.head).toBe(3)
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
    expect(fake.events.filter((row) => row.threadId === forked.id)).toHaveLength(0)
  })

  it('fork copy duplicates the rows up to the fork point with fresh ids', async () => {
    await seedThreadWithEvents(['user-said', 'assistant-said', 'user-said'])

    const forked = await service.fork({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { seq: 2, mode: 'copy' },
    })

    const copied = fake.events.filter((row) => row.threadId === forked.id)
    expect(copied.map((row) => row.seq)).toEqual([1, 2])
    // Fresh ids are `evt_<uuid>`, so a prefix check against the seeds flakes whenever the uuid
    // opens with a colliding character; only reuse of the exact seeded ids proves a copy failed.
    expect(copied.every((row) => !['evt_1', 'evt_2'].includes(row.id))).toBe(true)
    expect(copied.every((row) => row.userId === USER_A)).toBe(true)
  })

  it('fork past the head is refused', async () => {
    await seedThreadWithEvents(['user-said'])

    await expect(
      service.fork({ userId: USER_A, threadId: 'brn_one', draft: { seq: 5, mode: 'copy' } }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
