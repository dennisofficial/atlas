import { describe, expect, it } from 'bun:test'

import { EDaemonAnswer } from '@dltech/atlas-core'
import { ECallFailure, ECallStatus, type CallResult } from '@dltech/atlas-protocol'

import type { CallLane } from '../call-open'
import type { DaemonAnswer } from '../errors'
import { handleHello } from '../hello-reply'
import type { Pending } from '../remote-calls-frames'

const laneOf = (args: {
  answers: DaemonAnswer[]
}): {
  lane: CallLane
  runs: string[]
  settled: CallResult[]
  pending: Map<string, Pending>
} => {
  const pending = new Map<string, Pending>()
  const runs: string[] = []
  const settled: CallResult[] = []
  const answers = [...args.answers]
  let bootId: string | undefined = 'boot-a'
  const lane = {
    pending,
    answers: {
      ask: async () => answers.shift() ?? 'unavailable',
    } as unknown as CallLane['answers'],
    detached: () => false,
    gone: () => false,
    linkReady: () => true,
    bootId: () => bootId,
    ready: async () => ({ bootId: bootId ?? '', version: 'test', restart: false }),
    arrived: (frame: { bootId: string; version: string }) => {
      bootId = frame.bootId
    },
    flushAcks: () => 0,
    logged: () => undefined,
    helloReady: () => undefined,
    listed: () => [...pending.values()],
    sendCancel: () => undefined,
    sendRun: (call: Pending) => {
      runs.push(call.key)
    },
    resizeReason: () => undefined,
    settle: (call: Pending, result: CallResult) => {
      call.done = true
      pending.delete(call.key)
      settled.push(result)
    },
    schedulePing: () => undefined,
  } as CallLane
  return { lane, runs, settled, pending }
}

const sentCall = (dispatchedBootId: string | undefined): Pending => ({
  key: 'run-1:call-1.abc.0',
  op: { op: 'exec', argv: ['/bin/sh', '-c', 'echo hi'], cwd: '/' },
  waiters: [],
  controller: new AbortController(),
  delivered: 0,
  sent: true,
  armed: true,
  done: false,
  awaitingAnswer: false,
  recovering: false,
  ...(dispatchedBootId === undefined ? {} : { dispatchedBootId }),
})

const interrupted = (results: readonly CallResult[]): boolean =>
  results.some(
    (result) =>
      result.status === ECallStatus.Failed && result.error.code === ECallFailure.Interrupted,
  )

describe('a handoff whose recovery answer never arrives', () => {
  it('retries the recovery on the next hello and never re-runs the operation blind', async () => {
    const rig = laneOf({ answers: ['unavailable', EDaemonAnswer.NeverSeen] })
    rig.pending.set('run-1:call-1.abc.0', sentCall('boot-a'))

    handleHello(rig.lane, { bootId: 'boot-b', version: 'test' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(rig.runs).toHaveLength(0)
    expect(rig.settled).toHaveLength(0)

    handleHello(rig.lane, { bootId: 'boot-b', version: 'test' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(rig.runs).toHaveLength(0)
    expect(interrupted(rig.settled)).toBe(true)
  })

  it('holds a call whose dispatch carries no boot instead of interrupting it', async () => {
    const rig = laneOf({ answers: [EDaemonAnswer.NeverSeen] })
    rig.pending.set('run-1:call-1.abc.0', sentCall(undefined))

    handleHello(rig.lane, { bootId: 'boot-b', version: 'test' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(rig.runs).toHaveLength(0)
    expect(rig.settled).toHaveLength(0)
  })

  it('runs the operation again when the pod answers that the same boot never saw it', async () => {
    const rig = laneOf({ answers: [EDaemonAnswer.NeverSeen] })
    rig.pending.set('run-1:call-1.abc.0', sentCall('boot-a'))

    handleHello(rig.lane, { bootId: 'boot-a', version: 'test' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(rig.runs).toEqual(['run-1:call-1.abc.0'])
    expect(rig.settled).toHaveLength(0)
  })
})
