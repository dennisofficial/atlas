import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../generated/prisma/client'

vi.mock('../../db', async () => {
  const { fakeSessionDb } = await import('../../../test/fake-session-db.js')
  return { db: fakeSessionDb().db as unknown as PrismaClient }
})

import { fakeSessionDb, type FakeThreadRow, type FakeTurnRow } from '../../../test/fake-session-db.js'
import { TurnsService } from './turns.service'

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

const turnDraft = {
  status: 'done',
  providerId: 'anthropic',
  modelId: 'claude-opus',
  steps: 3,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 25,
  cacheWriteTokens: 10,
  startedAt: '2026-09-15T00:00:00.000Z',
  endedAt: '2026-09-15T00:01:00.000Z',
  durationMs: 60_000,
}

const turnRow = (partial: Partial<FakeTurnRow> & { runId: string }): FakeTurnRow => ({
  threadId: 'brn_one',
  userId: USER_A,
  ...turnDraft,
  ...partial,
})

describe('TurnsService', () => {
  let service: TurnsService

  beforeEach(() => {
    fake.reset()
    fake.threads.push(threadRow({ id: 'brn_one' }))
    service = new TurnsService()
  })

  it('record upserts by runId', async () => {
    await service.record({
      userId: USER_A,
      threadId: 'brn_one',
      runId: 'run_1',
      draft: turnDraft,
    })
    await service.record({
      userId: USER_A,
      threadId: 'brn_one',
      runId: 'run_1',
      draft: { ...turnDraft, steps: 9 },
    })

    expect(fake.turns).toHaveLength(1)
    expect(fake.turns[0]?.steps).toBe(9)
  })

  it('forThread orders by start time', async () => {
    fake.turns.push(
      turnRow({ runId: 'run_late', startedAt: '2026-09-15T02:00:00.000Z' }),
      turnRow({ runId: 'run_early', startedAt: '2026-09-15T00:00:00.000Z' }),
    )

    const turns = await service.forThread({ userId: USER_A, threadId: 'brn_one' })
    expect(turns.map((turn) => turn.runId)).toEqual(['run_early', 'run_late'])
  })

  it('forThreadTree splits own spend from delegated spend', async () => {
    fake.threads.push(
      threadRow({ id: 'brn_child', spawnerThreadId: 'brn_one', agentType: 'explore' }),
    )
    fake.turns.push(
      turnRow({ runId: 'run_own' }),
      turnRow({ runId: 'run_child', threadId: 'brn_child' }),
    )

    const tree = await service.forThreadTree({ userId: USER_A, threadId: 'brn_one' })
    expect(tree.own.map((turn) => turn.runId)).toEqual(['run_own'])
    expect(tree.delegated.map((turn) => turn.runId)).toEqual(['run_child'])
  })
})
