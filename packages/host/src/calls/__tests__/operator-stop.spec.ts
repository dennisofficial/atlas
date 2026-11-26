import { describe, expect, it } from 'bun:test'

import {
  EDaemonAnswer,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type EventBody,
  type Stamped,
} from '@dltech/atlas-core'
import { ECallFailure, ECallStatus, EExecOutcome, type CallResult } from '@dltech/atlas-protocol'

import { cancelDebtsOf } from '../cancel-debts'
import { openCallsOn, startFakePod, until, type FakePod } from './fake-pod'

const KEY = 'call-1.0'
const CALL = toCallId('call-1')

const eventOf = <TBody extends EventBody>(body: TBody): Stamped<TBody> =>
  ({
    ...body,
    id: toEventId('event-1'),
    seq: 1,
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    depth: 0,
    at: '2026-01-01T00:00:00.000Z',
  }) as Stamped<TBody>

const stoppedDebtsOf = (pod: FakePod): ReturnType<typeof cancelDebtsOf> =>
  cancelDebtsOf({
    events: [
      eventOf({ type: 'tool-dispatched', callId: CALL, name: 'bash', bootId: pod.daemon.bootId }),
      eventOf({
        type: 'tool-result',
        callId: CALL,
        name: 'bash',
        interrupted: true,
        error: { message: 'cancelled' },
      }),
    ],
    stepsOf: () => [],
    daemonTools: new Set(['bash']),
  })

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

  it('cancels a replayed step that the pod is already running under its key', async () => {
    const pod = await startFakePod()
    pod.daemon.running.add(KEY)
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

    controller.abort()
    await until(() => state.settled)
    expect(pod.daemon.cancels).toEqual([KEY])

    pod.answerNow({ key: KEY, state: EDaemonAnswer.Running })
    await until(() => pod.daemon.running.has(KEY) === false)
    pod.drop()
    await until(() => pod.daemon.waiting)
    await pod.open()

    expect(pod.daemon.cancels).toEqual([KEY])
    expect(pod.daemon.runs).toEqual([])
    expect(pod.daemon.running.has(KEY)).toBe(false)
    pod.calls.close()
  })

  it('owes the cancel of a replayed step while the link is down', async () => {
    const pod = await startFakePod()
    pod.daemon.running.add(KEY)
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

    pod.drop()
    await until(() => pod.daemon.waiting)
    controller.abort()
    await until(() => state.settled)
    expect(pod.daemon.cancels).toEqual([])

    await pod.open()
    await until(() => pod.daemon.cancels.length === 1)
    expect(pod.daemon.cancels).toEqual([KEY])
    expect(pod.daemon.running.has(KEY)).toBe(false)
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

  it('cancels the pod work a replaced holder committed as stopped', async () => {
    const pod = await startFakePod()
    const controller = new AbortController()
    const stopped = settledFlag(
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
    await until(() => stopped.settled)
    pod.calls.close()
    expect(pod.daemon.running.has(KEY)).toBe(true)

    const debts = stoppedDebtsOf(pod)
    expect(debts).toEqual([{ key: KEY, bootId: pod.daemon.bootId }])

    const next = await openCallsOn(pod, { epoch: 2 })
    next.cancelOwed(debts)
    await until(() => pod.daemon.cancels.includes(KEY))
    expect(pod.daemon.running.has(KEY)).toBe(false)
    next.close()
  })
})
