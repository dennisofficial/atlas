import { describe, expect, it, mock } from 'bun:test'
import { CronNeverFiresError } from '@dltech/atlas-schedule'
import { routineRunPayloadSchema } from '@dltech/atlas-jobs'
import { triggerSdkFake } from './trigger-sdk.fake'
import { routineRowOf, runGraphOf, type WriteRecord } from './routine-graph.fake'
import type { RoutineGraph } from '../trigger/routine/routine-graph'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)

const { recordRoutineFailure, routineRunTask, runRoutineOnce } = await import(
  '../trigger/routine/routine-run.task'
)

type CapturedRunParams = Parameters<RoutineGraph['plane']['runRoutine']>[0]

const captureRunParams = (): { seen: CapturedRunParams | undefined } => ({ seen: undefined })

const runWithCapture = async (params: {
  capture: { seen: CapturedRunParams | undefined }
  routine?: Parameters<typeof routineRowOf>[0]
  scheduledFor?: string
}): Promise<Awaited<ReturnType<typeof runRoutineOnce>>> =>
  runRoutineOnce({
    graph: runGraphOf({
      routine: routineRowOf(params.routine),
      runRoutine: async (runParams) => {
        params.capture.seen = runParams
        return { outcome: 'started', sessionId: 'ses_1' }
      },
    }),
    payload: {
      routineId: 'rtn_1',
      scheduledFor: params.scheduledFor ?? '2026-11-10T03:00:00.000Z',
    },
    now: '2026-11-10T03:00:02.000Z',
  })

describe('routine run task', () => {
  it('registers under the contract id with one retry budget and a shared concurrency limit', () => {
    expect(routineRunTask).toMatchObject({
      id: 'routine-run',
      maxDuration: 60,
      retry: { maxAttempts: 3 },
      concurrency: { name: 'routine-runs', total: 3 },
    })
  })

  it('parses its payload with the contract schema', () => {
    expect(Object.getOwnPropertyDescriptor(routineRunTask, 'schema')?.value).toBe(
      routineRunPayloadSchema,
    )
  })

  it('runs the occurrence the sweep dispatched', async () => {
    const capture = captureRunParams()

    const result = await runWithCapture({ capture })

    expect(result).toEqual({ outcome: 'started', sessionId: 'ses_1' })
    expect(capture.seen?.routineId).toBe('rtn_1')
    expect(capture.seen?.scheduledFor).toBe('2026-11-10T03:00:00.000Z')
    expect(capture.seen?.now).toBe('2026-11-10T03:00:02.000Z')
  })

  it('declares a run wedged after one interval of its own cron', async () => {
    const hourly = captureRunParams()
    const everyMinute = captureRunParams()

    await runWithCapture({ capture: hourly })
    await runWithCapture({ capture: everyMinute, routine: { cron: '* * * * *' } })

    expect(hourly.seen?.wedgedAfterMs).toBe(3_600_000)
    expect(everyMinute.seen?.wedgedAfterMs).toBe(60_000)
  })

  it('mints a session id and a main thread id', async () => {
    const capture = captureRunParams()

    await runWithCapture({ capture })

    const ids = capture.seen?.createSessionId()

    expect(ids?.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(ids?.mainThreadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(ids?.mainThreadId).not.toBe(ids?.sessionId)
  })

  it('advances the schedule on the routine timezone', async () => {
    const capture = captureRunParams()

    await runWithCapture({ capture, routine: { timezone: 'America/New_York' } })

    expect(capture.seen?.nextOccurrence({ after: '2026-11-10T03:00:00.000Z' })).toBe(
      '2026-11-10T08:00:00.000Z',
    )
  })

  it('fails the run when the cron can never fire', async () => {
    const capture = captureRunParams()

    await runWithCapture({ capture, routine: { cron: '0 0 30 2 *' } })

    expect(() => capture.seen?.nextOccurrence({ after: '2026-11-10T03:00:00.000Z' })).toThrow(
      CronNeverFiresError,
    )
  })

  it('fails the run when the stored cron does not parse', async () => {
    await expect(
      runWithCapture({ capture: captureRunParams(), routine: { cron: 'soon' } }),
    ).rejects.toThrow('does not parse')
  })

  it('leaves a routine that no longer exists to the control plane', async () => {
    const result = await runRoutineOnce({
      graph: runGraphOf({ routine: undefined }),
      payload: { routineId: 'rtn_gone', scheduledFor: '2026-11-10T03:00:00.000Z' },
      now: '2026-11-10T03:00:02.000Z',
    })

    expect(result).toEqual({ outcome: 'skipped', reason: 'routine-not-found' })
  })
})

describe('a failed routine run', () => {
  const writes = (): WriteRecord => ({ advanced: [], runs: [] })

  it('advances past the failed occurrence and records why', async () => {
    const record = writes()

    await recordRoutineFailure({
      graph: runGraphOf({ routine: routineRowOf(), writes: record }),
      payload: { routineId: 'rtn_1', scheduledFor: '2026-11-10T03:00:00.000Z' },
      error: new Error('sandbox never answered'),
      now: '2026-11-10T03:00:02.000Z',
    })

    expect(record.advanced).toEqual([
      {
        routineId: 'rtn_1',
        expectedNextRunAt: '2026-11-10T03:00:00.000Z',
        nextRunAt: '2026-11-11T03:00:00.000Z',
        at: '2026-11-10T03:00:02.000Z',
      },
    ])
    expect(record.runs).toEqual([
      {
        routineId: 'rtn_1',
        scheduledFor: '2026-11-10T03:00:00.000Z',
        outcome: 'failed',
        reason: 'failed: sandbox never answered',
      },
    ])
  })

  it('records nothing when another executor already moved the schedule', async () => {
    const record = writes()

    await recordRoutineFailure({
      graph: runGraphOf({ routine: routineRowOf(), advanced: false, writes: record }),
      payload: { routineId: 'rtn_1', scheduledFor: '2026-11-10T03:00:00.000Z' },
      error: new Error('boom'),
      now: '2026-11-10T03:00:02.000Z',
    })

    expect(record.advanced.length).toBe(1)
    expect(record.runs).toEqual([])
  })

  it('leaves a schedule that has already moved on untouched', async () => {
    const record = writes()

    await recordRoutineFailure({
      graph: runGraphOf({
        routine: routineRowOf({ nextRunAt: '2026-11-11T03:00:00.000Z' }),
        writes: record,
      }),
      payload: { routineId: 'rtn_1', scheduledFor: '2026-11-10T03:00:00.000Z' },
      error: new Error('boom'),
      now: '2026-11-10T03:00:02.000Z',
    })

    expect(record.nextRunAt).toBe('2026-11-11T03:00:00.000Z')
    expect(record.runs).toEqual([])
  })

  it('does nothing for a routine that was deleted mid-run', async () => {
    const record = writes()

    await recordRoutineFailure({
      graph: runGraphOf({ routine: undefined, writes: record }),
      payload: { routineId: 'rtn_gone', scheduledFor: '2026-11-10T03:00:00.000Z' },
      error: new Error('boom'),
      now: '2026-11-10T03:00:02.000Z',
    })

    expect(record).toEqual({ advanced: [], runs: [] })
  })

  it('still advances when the cron cannot produce a next occurrence', async () => {
    const record = writes()

    await recordRoutineFailure({
      graph: runGraphOf({ routine: routineRowOf({ cron: '0 0 30 2 *' }), writes: record }),
      payload: { routineId: 'rtn_1', scheduledFor: '2026-11-10T03:00:00.000Z' },
      error: new Error('boom'),
      now: '2026-11-10T03:00:02.000Z',
    })

    expect(record.advanced.map((advance) => advance.nextRunAt)).toEqual([
      '2026-11-10T04:00:02.000Z',
    ])
  })
})
