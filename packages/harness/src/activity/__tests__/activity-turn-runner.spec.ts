import { describe, expect, it } from 'bun:test'
import { toRunId, toThreadId } from '@dltech/atlas-core'

import { createDeltaChannel } from '../../channel/delta-channel'
import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import { ActivityTurnRunner } from '../activity-turn-runner'
import { RuntimeSessionActivity } from '../runtime-session-activity'

const threadId = toThreadId('root')
const arrange = (invoke: () => Promise<TurnOutcome>) => {
  const activity = new RuntimeSessionActivity({
    runtimeId: 'runtime',
    log: { refresh: async () => {}, readOwn: async () => [] },
    input: { pending: () => null },
    channel: createDeltaChannel(),
    roster: { read: async () => ({ agents: [], shells: [] }), subscribe: () => () => {} },
  })
  return {
    activity,
    runner: new ActivityTurnRunner({
      inner: { say: invoke, runTurn: invoke, resume: invoke },
      lifecycle: activity,
    }),
  }
}

describe('activity turn runner', () => {
  it('preserves a deferred completion when the activity runtime closes during the turn', async () => {
    const gate = Promise.withResolvers<TurnOutcome>()
    const h = arrange(() => gate.promise)
    const pending = h.runner.runTurn({ threadId })
    h.activity.close()
    const outcome = { status: ETurnStatus.Completed, runId: toRunId('after-close') } as const
    gate.resolve(outcome)
    expect(await pending).toBe(outcome)
    await expect(h.activity.read({ threadId })).rejects.toThrow('Activity runtime is closed')
  })

  it('preserves a deferred escaped failure when the activity runtime closes during the turn', async () => {
    const gate = Promise.withResolvers<TurnOutcome>()
    const h = arrange(() => gate.promise)
    const pending = h.runner.runTurn({ threadId })
    h.activity.close()
    const cause = new Error('original failure after close')
    gate.reject(cause)
    await expect(pending).rejects.toBe(cause)
    await expect(h.activity.read({ threadId })).rejects.toThrow('Activity runtime is closed')
  })

  it('wraps each invocation without replacing the genuine return value', async () => {
    const outcome = { status: ETurnStatus.Completed, runId: toRunId('actual') } as const
    const h = arrange(async () => outcome)
    expect(await h.runner.say({ threadId, text: 'go' })).toBe(outcome)
    expect(await h.runner.runTurn({ threadId })).toBe(outcome)
    expect(await h.runner.resume({ threadId })).toBe(outcome)
    expect(await h.activity.read({ threadId })).toMatchObject({
      turnEpoch: 3,
      working: false,
      observedOutcome: { identity: { kind: 'run', runId: 'actual' }, outcome: 'completed' },
    })
    h.activity.close()
  })

  it('rethrows the original escaped failure and deduplicates the driver failure callback', async () => {
    const cause = new Error('escaped runtime failure')
    const h = arrange(async () => {
      throw cause
    })
    await expect(h.runner.runTurn({ threadId })).rejects.toBe(cause)
    const first = await h.activity.read({ threadId })
    expect(first).toMatchObject({
      turnEpoch: 1,
      working: false,
      observedOutcome: {
        identity: { kind: 'driver-failure', runtimeId: 'runtime', revision: 2 },
        outcome: 'failed',
      },
    })
    h.activity.turnFailed({ threadId })
    expect(await h.activity.read({ threadId })).toEqual(first)
    await expect(h.runner.resume({ threadId })).rejects.toBe(cause)
    expect(await h.activity.read({ threadId })).toMatchObject({
      turnEpoch: 2,
      observedOutcome: {
        identity: { kind: 'driver-failure', runtimeId: 'runtime', revision: 5 },
        outcome: 'failed',
      },
    })
    h.activity.close()
  })

  it('records a genuine driver policy failure after the wrapped runner already returned', async () => {
    const outcome = {
      status: ETurnStatus.Completed,
      runId: toRunId('finished-before-policy'),
    } as const
    const h = arrange(async () => outcome)
    await h.runner.runTurn({ threadId })
    h.activity.turnFailed({ threadId })
    const reading = await h.activity.read({ threadId })
    expect(reading).toMatchObject({
      turnEpoch: 1,
      working: false,
      observedOutcome: {
        identity: { kind: 'driver-failure', runtimeId: 'runtime', revision: 4 },
        outcome: 'failed',
      },
    })
    h.activity.turnFailed({ threadId })
    expect(await h.activity.read({ threadId })).toEqual(reading)
    h.activity.close()
  })

  it('keeps a returned failed run distinct from an escaped runtime failure', async () => {
    const outcome = {
      status: ETurnStatus.Failed,
      runId: toRunId('failed'),
      cause: null,
      message: 'failed',
    } as const
    const h = arrange(async () => outcome)
    expect(await h.runner.runTurn({ threadId })).toBe(outcome)
    expect(await h.activity.read({ threadId })).toMatchObject({
      observedOutcome: { identity: { kind: 'run', runId: 'failed' }, outcome: 'failed' },
    })
    h.activity.close()
  })
})
