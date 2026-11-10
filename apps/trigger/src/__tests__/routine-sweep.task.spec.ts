import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { batchTriggerRecords, triggerSdkFake } from './trigger-sdk.fake'
import { routineRowOf, sweepGraphOf, type DueRead } from './routine-graph.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)

const { ROUTINE_SWEEP_CRON, ROUTINE_SWEEP_LIMIT, routineSweepTask, runRoutineSweep } = await import(
  '../trigger/routine/routine-sweep.task'
)

describe('routine sweep task', () => {
  beforeEach(() => {
    batchTriggerRecords.length = 0
  })

  it('registers under the contract id on a one minute cron', () => {
    expect(routineSweepTask).toMatchObject({ id: 'routine-sweep', cron: '*/1 * * * *' })
    expect(ROUTINE_SWEEP_CRON).toBe('*/1 * * * *')
  })

  it('dispatches one child per due routine in a single batch', async () => {
    const rows = [
      routineRowOf({ routineId: 'rtn_1', nextRunAt: '2026-11-10T03:00:00.000Z' }),
      routineRowOf({ routineId: 'rtn_2', nextRunAt: '2026-11-10T03:05:00.000Z' }),
    ]

    const output = await runRoutineSweep({
      graph: sweepGraphOf({ rows }),
      now: '2026-11-10T03:00:30.000Z',
    })

    expect(output).toEqual({ dispatched: 2 })
    expect(batchTriggerRecords.map((record) => record.taskId)).toEqual([
      'routine-run',
      'routine-run',
    ])
    expect(batchTriggerRecords.map((record) => record.payload)).toEqual([
      { routineId: 'rtn_1', scheduledFor: '2026-11-10T03:00:00.000Z' },
      { routineId: 'rtn_2', scheduledFor: '2026-11-10T03:05:00.000Z' },
    ])
  })

  it('keys each child by routine and occurrence so a second sweep cannot duplicate it', async () => {
    const rows = [routineRowOf({ routineId: 'rtn_1', nextRunAt: '2026-11-10T03:00:00.000Z' })]

    await runRoutineSweep({ graph: sweepGraphOf({ rows }), now: '2026-11-10T03:00:30.000Z' })

    expect(batchTriggerRecords.map((record) => record.idempotencyKey)).toEqual([
      'routine:rtn_1:2026-11-10T03:00:00.000Z',
    ])
  })

  it('asks the store for the due page it dispatches', async () => {
    const read: DueRead = { now: undefined, limit: undefined }

    await runRoutineSweep({
      graph: sweepGraphOf({ rows: [], read }),
      now: '2026-11-10T03:00:30.000Z',
    })

    expect(read).toEqual({ now: '2026-11-10T03:00:30.000Z', limit: ROUTINE_SWEEP_LIMIT })
    expect(ROUTINE_SWEEP_LIMIT).toBe(50)
  })

  it('dispatches nothing when no routine is due', async () => {
    const output = await runRoutineSweep({
      graph: sweepGraphOf({ rows: [] }),
      now: '2026-11-10T03:00:30.000Z',
    })

    expect(output).toEqual({ dispatched: 0 })
    expect(batchTriggerRecords).toEqual([])
  })

  it('refuses a due row whose next run is not a timestamp', async () => {
    const rows = [routineRowOf({ nextRunAt: 'soon' })]

    await expect(
      runRoutineSweep({ graph: sweepGraphOf({ rows }), now: '2026-11-10T03:00:30.000Z' }),
    ).rejects.toThrow()
    expect(batchTriggerRecords).toEqual([])
  })
})
