import { describe, expect, it } from 'bun:test'
import { notifyGraphOf } from './notify-graph.fake'
import { notifyRoutineFailure } from '../trigger/routine/routine-failure-notify'

const failure = {
  routineId: 'rtn_1',
  routineName: 'Monday L10 Meeting Prep',
  userId: 'usr-1',
  reason: 'failed: stored event t:20 is invalid',
}

const NOON_UTC = '2026-11-23T12:01:29.000Z'

describe('a failed scheduled routine run', () => {
  it('pushes the routine owner a notice that names the routine and the reason', async () => {
    const { graph, record } = notifyGraphOf({ now: NOON_UTC })

    const counts = await notifyRoutineFailure({ graph, failure })

    expect(counts).toEqual({ sent: 1, gone: 0 })
    expect(record.delivered).toHaveLength(1)
    expect(record.touched).toEqual([{ deviceId: 'device-1', now: NOON_UTC }])
  })

  it('stays silent when the owner turned failure pushes off', async () => {
    const { graph, record } = notifyGraphOf({
      now: NOON_UTC,
      settings: new Map([['web.notifications.event.errored.push', false]]),
    })

    expect(await notifyRoutineFailure({ graph, failure })).toEqual({ sent: 0, gone: 0 })
    expect(record.delivered).toEqual([])
  })

  it('sends nothing when the owner has no device', async () => {
    const { graph, record } = notifyGraphOf({ now: NOON_UTC, devices: [] })

    expect(await notifyRoutineFailure({ graph, failure })).toEqual({ sent: 0, gone: 0 })
    expect(record.delivered).toEqual([])
  })
})
