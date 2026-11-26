import { describe, expect, it } from 'bun:test'

import { EDaemonAnswer } from '@dltech/atlas-core'
import { ECallFailure, ECallStatus, EExecOutcome, type CallResult } from '@dltech/atlas-protocol'

import { startFakePod, tick, until } from './fake-pod'

const execResult = (): CallResult => ({
  status: ECallStatus.Ok,
  op: 'exec',
  value: { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes: 0 },
})

const KEY = 'call-1.0'

const replayed = (args: {
  bootId: string
}): {
  key: string
  op: { op: 'exec'; argv: string[] }
  replayed: true
  dispatchedBootId: string
} => ({
  key: KEY,
  op: { op: 'exec', argv: ['true'] },
  replayed: true,
  dispatchedBootId: args.bootId,
})

const settledFlag = (promise: Promise<CallResult>) => {
  const state = { settled: false, result: undefined as CallResult | undefined }
  void promise.then((result) => {
    state.settled = true
    state.result = result
  })
  return state
}

describe('a replayed step asks the daemon first', () => {
  it('runs the recorded key when the daemon holds a result for it', async () => {
    const pod = await startFakePod()
    pod.daemon.answer = EDaemonAnswer.Done

    const outcome = pod.calls.invoke(replayed({ bootId: pod.daemon.bootId }))
    const state = settledFlag(outcome)
    await until(() => pod.daemon.runs.length > 0)
    expect(pod.daemon.answers).toEqual([KEY])
    expect(pod.daemon.runs).toEqual([KEY])

    pod.finish({ key: KEY, result: execResult() })
    await until(() => state.settled)
    expect(state.result?.status).toBe(ECallStatus.Ok)
    pod.calls.close()
  })

  it('runs a step the same boot never saw', async () => {
    const pod = await startFakePod()
    pod.daemon.answer = EDaemonAnswer.NeverSeen

    void pod.calls.invoke(replayed({ bootId: pod.daemon.bootId })).catch(() => undefined)
    await until(() => pod.daemon.runs.length > 0)
    expect(pod.daemon.runs).toEqual([KEY])
    pod.calls.close()
  })

  it('interrupts a step a different boot never saw, and never sends it', async () => {
    const pod = await startFakePod({ bootId: 'boot-b' })
    pod.daemon.answer = EDaemonAnswer.NeverSeen

    const result = await pod.calls.invoke(replayed({ bootId: 'boot-a' }))
    expect(result.status).toBe(ECallStatus.Failed)
    expect(result.status === ECallStatus.Failed && result.error.code).toBe(ECallFailure.Interrupted)
    expect(pod.daemon.runs).toEqual([])
    pod.calls.close()
  })

  it('attaches to a step the daemon is still running', async () => {
    const pod = await startFakePod()
    pod.daemon.answer = EDaemonAnswer.Running

    const outcome = pod.calls.invoke(replayed({ bootId: pod.daemon.bootId }))
    const state = settledFlag(outcome)
    await until(() => pod.daemon.runs.length > 0)
    expect(state.settled).toBe(false)

    pod.finish({ key: KEY, result: execResult() })
    await until(() => state.settled)
    expect(state.result?.status).toBe(ECallStatus.Ok)
    pod.calls.close()
  })

  it('waits when the daemon cannot answer, then asks again on the next hello', async () => {
    const pod = await startFakePod()
    pod.daemon.withholdAnswer = true

    const outcome = pod.calls.invoke(replayed({ bootId: pod.daemon.bootId }))
    const state = settledFlag(outcome)
    await until(() => pod.daemon.answers.length === 1)

    pod.drop()
    await tick()
    expect(state.settled).toBe(false)
    expect(pod.daemon.runs).toEqual([])

    pod.daemon.withholdAnswer = false
    pod.daemon.answer = EDaemonAnswer.Running
    await until(() => pod.daemon.waiting)
    await pod.open()
    await until(() => pod.daemon.runs.length > 0)
    expect(pod.daemon.answers).toEqual([KEY, KEY])

    pod.finish({ key: KEY, result: execResult() })
    await until(() => state.settled)
    expect(state.result?.status).toBe(ECallStatus.Ok)
    pod.calls.close()
  })
})
