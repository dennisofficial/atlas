import { describe, expect, it } from 'bun:test'

import { EDaemonAnswer } from '@dltech/atlas-core'
import { ECallFailure, ECallStatus, type CallResult } from '@dltech/atlas-protocol'

import { openCall, type CallLane } from '../call-open'
import type { DaemonAnswer } from '../errors'
import type { Pending } from '../remote-calls-frames'

const BOOT = 'boot-now'
const OLD_BOOT = 'boot-before'

const laneOf = (args: {
  answer: DaemonAnswer
  disconnected?: boolean
}): {
  lane: CallLane
  runs: string[]
  settled: CallResult[]
} => {
  const pending = new Map<string, Pending>()
  const runs: string[] = []
  const settled: CallResult[] = []
  const lane: CallLane = {
    pending,
    answers: { ask: async () => args.answer } as unknown as CallLane['answers'],
    detached: () => false,
    gone: () => false,
    linkReady: () => args.disconnected !== true,
    bootId: () => BOOT,
    ready: async () => ({ bootId: BOOT, version: 'test', restart: false }),
    arrived: () => undefined,
    flushAcks: () => 0,
    logged: () => undefined,
    helloReady: () => undefined,
    listed: () => [...pending.values()],
    sendCancel: () => undefined,
    sendRun: (call) => {
      runs.push(call.key)
    },
    resizeReason: () => undefined,
    settle: (call, result) => {
      call.done = true
      pending.delete(call.key)
      settled.push(result)
    },
    schedulePing: () => undefined,
  }
  return { lane, runs, settled }
}

const attachOnly = async (args: {
  answer: DaemonAnswer
  dispatchedBootId?: string
}): Promise<{ runs: string[]; settled: CallResult[] }> => {
  const { lane, runs, settled } = laneOf({ answer: args.answer })
  void openCall({
    lane,
    dispatchedBootId: args.dispatchedBootId,
    request: {
      key: 'run-1:call-1.abc.0',
      op: { op: 'exec', argv: ['/bin/sh', '-c', 'true'], cwd: '/' },
      attachOnly: true,
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 5))
  return { runs, settled }
}

const interrupted = (results: readonly CallResult[]): boolean =>
  results.some(
    (result) =>
      result.status === ECallStatus.Failed && result.error.code === ECallFailure.Interrupted,
  )

describe('a setup call that re-joins the pod after a handoff', () => {
  it('performs the first run when the pod never saw it on the boot it was dispatched on', async () => {
    const { runs, settled } = await attachOnly({
      answer: EDaemonAnswer.NeverSeen,
      dispatchedBootId: BOOT,
    })
    expect(settled).toHaveLength(0)
    expect(runs).toEqual(['run-1:call-1.abc.0'])
  })

  it('reports the setup interrupted only when the pod booted after the dispatch', async () => {
    const { runs, settled } = await attachOnly({
      answer: EDaemonAnswer.NeverSeen,
      dispatchedBootId: OLD_BOOT,
    })
    expect(runs).toHaveLength(0)
    expect(interrupted(settled)).toBe(true)
  })

  it('waits instead of guessing when no dispatch boot is recorded', async () => {
    const { runs, settled } = await attachOnly({ answer: EDaemonAnswer.NeverSeen })
    expect(settled).toHaveLength(0)
    expect(runs).toHaveLength(0)
  })
})
