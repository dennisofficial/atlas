import { describe, expect, it } from 'bun:test'
import {
  ROUTINE_RUN_TASK_ID,
  ROUTINE_SWEEP_TASK_ID,
  type RoutineRunPayload,
  routineRunIdempotencyKey,
  routineRunPayloadSchema,
  routineSweepPayloadSchema,
} from '../index'

describe('routine contracts', () => {
  it('names the task ids the trigger routes deploy', () => {
    expect(ROUTINE_SWEEP_TASK_ID).toBe('routine-sweep')
    expect(ROUTINE_RUN_TASK_ID).toBe('routine-run')
  })

  it('accepts an empty sweep payload', () => {
    expect(routineSweepPayloadSchema.parse({})).toEqual({})
  })

  it('rejects a sweep payload with fields the task never reads', () => {
    expect(routineSweepPayloadSchema.safeParse({ limit: 10 }).success).toBe(false)
  })

  it('round-trips a run payload', () => {
    const payload: RoutineRunPayload = {
      routineId: 'rtn_1',
      scheduledFor: '2026-11-10T03:00:00.000Z',
    }

    const encoded = JSON.parse(JSON.stringify(routineRunPayloadSchema.parse(payload)))

    expect(routineRunPayloadSchema.parse(encoded)).toEqual(payload)
  })

  it('rejects a run payload that names no routine or no occurrence', () => {
    expect(
      routineRunPayloadSchema.safeParse({ routineId: '', scheduledFor: '2026-11-10T03:00:00.000Z' })
        .success,
    ).toBe(false)
    expect(
      routineRunPayloadSchema.safeParse({ routineId: 'rtn_1', scheduledFor: 'soon' }).success,
    ).toBe(false)
  })

  it('keys an occurrence by routine and scheduled time', () => {
    const key = routineRunIdempotencyKey({
      routineId: 'rtn_1',
      scheduledFor: '2026-11-10T03:00:00.000Z',
    })

    expect(key).toBe('routine:rtn_1:2026-11-10T03:00:00.000Z')
    expect(
      routineRunIdempotencyKey({ routineId: 'rtn_1', scheduledFor: '2026-11-11T03:00:00.000Z' }),
    ).not.toBe(key)
  })
})
