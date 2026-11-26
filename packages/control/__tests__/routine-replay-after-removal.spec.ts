import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '../src/control-plane'
import {
  routineCreateOf,
  routineRemoveOf,
  routineRunNowOf,
  routineUpdateOf,
} from '../src/routine-service'
import { InMemoryControlStore } from '../src/testing/memory'

const planeOf = () =>
  new ControlPlane({
    store: new InMemoryControlStore({ clock: () => '2026-11-26T10:00:00.000Z' }),
  })

const input = {
  projectId: 'p1',
  name: 'standup',
  prompt: 'report',
  cron: '0 9 * * 1-5',
  timezone: 'Europe/London',
}

describe('a routine receipt that outlives its routine', () => {
  it('returns the completed run receipt even if the routine was removed in between', async () => {
    const plane = planeOf()
    const routine = await routineCreateOf({ plane, userId: 'u1', input })
    const call = {
      plane,
      userId: 'u1',
      projectId: 'p1',
      routineId: routine.routineId,
      receipt: { threadId: 't1', stepKey: 'run.0' },
    }

    const first = await routineRunNowOf(call)
    await routineRemoveOf({ plane, userId: 'u1', routineId: routine.routineId })

    expect(await routineRunNowOf(call)).toEqual(first)
  })

  it('returns the completed update receipt even if the routine was removed in between', async () => {
    const plane = planeOf()
    const routine = await routineCreateOf({ plane, userId: 'u1', input })
    const call = {
      plane,
      userId: 'u1',
      projectId: 'p1',
      input: { routineId: routine.routineId, name: 'updated' },
      receipt: { threadId: 't1', stepKey: 'update.0' },
    }

    const first = await routineUpdateOf(call)
    await routineRemoveOf({ plane, userId: 'u1', routineId: routine.routineId })

    expect(await routineUpdateOf(call)).toEqual(first)
  })
})
