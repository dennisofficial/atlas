import { describe, expect, it } from 'bun:test'

import { ECallFailure, ECallStatus, EExecOutcome, type CallResult } from '@dltech/atlas-protocol'

import { startFakePod, until } from './fake-pod'

const KEY = 'call-1.0'

type Settled = { settled: boolean; result: CallResult | undefined }

const settledFlag = (promise: Promise<CallResult>): Settled => {
  const state: Settled = { settled: false, result: undefined }
  void promise.then((result) => {
    state.settled = true
    state.result = result
  })
  void promise.catch(() => undefined)
  return state
}

const failureOf = (
  result: CallResult | undefined,
): { code: string; message: string } | undefined =>
  result?.status === ECallStatus.Failed ? result.error : undefined

describe('an operator stop settles the call where it stands', () => {
  it('settles a replayed call the daemon never answered, without the answer', async () => {
    const pod = await startFakePod()
    pod.daemon.withholdAnswer = true
    const controller = new AbortController()
    const state = settledFlag(
      pod.calls.invoke({
        key: KEY,
        op: { op: 'exec', argv: ['true'] },
        replayed: true,
        dispatchedBootId: pod.daemon.bootId,
        signal: controller.signal,
      }),
    )
    await until(() => pod.daemon.answers.length === 1)
    expect(state.settled).toBe(false)

    controller.abort()
    await until(() => state.settled)

    expect(state.result?.status).toBe(ECallStatus.Ok)
    expect(state.result?.status === ECallStatus.Ok && state.result.value).toEqual({
      exitCode: null,
      signal: 'SIGTERM',
      outcome: EExecOutcome.Cancelled,
      outputBytes: 0,
    })
    expect(pod.daemon.runs).toEqual([])
    pod.calls.close()
  })

  it('settles a sent call with the link down, and owes the cancel to the same boot', async () => {
    const pod = await startFakePod()
    const controller = new AbortController()
    const state = settledFlag(
      pod.calls.invoke({
        key: KEY,
        op: { op: 'exec', argv: ['true'] },
        signal: controller.signal,
      }),
    )
    await until(() => pod.daemon.runs.length === 1)

    pod.drop()
    await until(() => pod.daemon.waiting)
    controller.abort()
    await until(() => state.settled)
    expect(state.settled).toBe(true)
    expect(pod.daemon.cancels).toEqual([])

    await pod.open()
    await until(() => pod.daemon.cancels.length === 1)
    expect(pod.daemon.cancels).toEqual([KEY])
    expect(pod.daemon.runs).toEqual([KEY])
    pod.calls.close()
  })

  it('settles a call still waiting for the link', async () => {
    const pod = await startFakePod()
    pod.drop()
    await until(() => pod.daemon.waiting)
    const controller = new AbortController()
    const state = settledFlag(
      pod.calls.invoke({
        key: KEY,
        op: { op: 'exec', argv: ['true'] },
        signal: controller.signal,
      }),
    )
    controller.abort()
    await until(() => state.settled)

    expect(state.result?.status).toBe(ECallStatus.Ok)
    pod.calls.close()
  })

  it('reports a stopped call as cancelled, never as a daemon restart', async () => {
    const pod = await startFakePod()
    pod.daemon.withholdAnswer = true
    const controller = new AbortController()
    const state = settledFlag(
      pod.calls.invoke({
        key: KEY,
        op: { op: 'readFile', path: '/w/a' },
        replayed: true,
        dispatchedBootId: pod.daemon.bootId,
        signal: controller.signal,
      }),
    )
    await until(() => pod.daemon.answers.length === 1)

    controller.abort()
    await until(() => state.settled)

    expect(failureOf(state.result)?.code).toBe(ECallFailure.Cancelled)
    expect(failureOf(state.result)?.message).not.toContain('restart')
    pod.calls.close()
  })
})
