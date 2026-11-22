import { describe, expect, it } from 'bun:test'

import { EPodDiskPressure } from '@dltech/atlas-core'

import { podDiskPressurePortOf } from './pod-disk-pressure.port'

const GB = 2 ** 30

const portWith = () => {
  const dispatched: Array<{ id: string; payload: unknown; idempotencyKey: string }> = []
  const dispatcher = {
    dispatch: async (args: {
      task: { id: string }
      payload: unknown
      idempotencyKey: string
    }): Promise<{ runId: string }> => {
      dispatched.push({
        id: args.task.id,
        payload: args.payload,
        idempotencyKey: args.idempotencyKey,
      })
      return { runId: `run-${dispatched.length}` }
    },
  }
  return { port: podDiskPressurePortOf({ dispatcher: dispatcher as never }), dispatched }
}

describe('the pod disk pressure port', () => {
  it('dispatches one grow task for the size the report earns', async () => {
    const { port, dispatched } = portWith()
    await port.report({
      sessionId: 'session-1',
      podSessionId: 'pod-1',
      usedBytes: 17 * GB,
      limitBytes: 20 * GB,
      pressure: EPodDiskPressure.Grow,
    })
    expect(dispatched).toEqual([
      {
        id: 'pod-disk-grow-one',
        payload: {
          podSessionId: 'pod-1',
          usedBytes: 17 * GB,
          limitBytes: 20 * GB,
          urgent: false,
        },
        idempotencyKey: 'pod-disk-grow-one:pod-1:40:false:0',
      },
    ])
  })

  it('collapses the repeats of one pressure level onto one key', async () => {
    const { port, dispatched } = portWith()
    const report = {
      sessionId: 'session-1',
      podSessionId: 'pod-1',
      usedBytes: 17 * GB,
      limitBytes: 20 * GB,
      pressure: EPodDiskPressure.Grow,
    }
    await port.report(report)
    await port.report(report)
    expect(dispatched.map((entry) => entry.idempotencyKey)).toEqual([
      'pod-disk-grow-one:pod-1:40:false:0',
      'pod-disk-grow-one:pod-1:40:false:0',
    ])
  })

  it('marks an urgent report, so the task grows without waiting for the pod', async () => {
    const { port, dispatched } = portWith()
    await port.report({
      sessionId: 'session-1',
      podSessionId: 'pod-1',
      usedBytes: 19.5 * GB,
      limitBytes: 20 * GB,
      pressure: EPodDiskPressure.Urgent,
    })
    expect(dispatched[0]?.payload).toMatchObject({ urgent: true })
    expect(dispatched[0]?.idempotencyKey).toBe('pod-disk-grow-one:pod-1:40:true:0')
  })

  it('dispatches nothing for a disk already at the biggest size', async () => {
    const { port, dispatched } = portWith()
    await port.report({
      sessionId: 'session-1',
      podSessionId: 'pod-1',
      usedBytes: 99 * GB,
      limitBytes: 100 * GB,
      pressure: EPodDiskPressure.Urgent,
    })
    expect(dispatched).toEqual([])
  })
})
