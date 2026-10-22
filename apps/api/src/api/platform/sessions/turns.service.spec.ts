import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedTurnRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { TurnsService } from './turns.service'

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

describe('TurnsService', () => {
  useTestDatabase()
  let service: TurnsService

  beforeEach(async () => {
    await seedUsers(USER_A)
    await seedThreadRow({ id: 'brn_one' })
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

    const stored = await db.orm.public.Turn.all()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.steps).toBe(9)
  })

  it('forThread orders by start time', async () => {
    await seedTurnRow({
      runId: 'run_late',
      threadId: 'brn_one',
      startedAt: new Date('2026-09-15T02:00:00.000Z'),
    })
    await seedTurnRow({
      runId: 'run_early',
      threadId: 'brn_one',
      startedAt: new Date('2026-09-15T00:00:00.000Z'),
    })

    const turns = await service.forThread({ userId: USER_A, threadId: 'brn_one' })
    expect(turns.map((turn) => turn.runId)).toEqual(['run_early', 'run_late'])
  })

  it('forThreadTree splits own spend from delegated spend', async () => {
    await seedThreadRow({ id: 'brn_child', spawnerThreadId: 'brn_one', agentType: 'explore' })
    await seedTurnRow({ runId: 'run_own', threadId: 'brn_one' })
    await seedTurnRow({ runId: 'run_child', threadId: 'brn_child' })

    const tree = await service.forThreadTree({ userId: USER_A, threadId: 'brn_one' })
    expect(tree.own.map((turn) => turn.runId)).toEqual(['run_own'])
    expect(tree.delegated.map((turn) => turn.runId)).toEqual(['run_child'])
  })
})
