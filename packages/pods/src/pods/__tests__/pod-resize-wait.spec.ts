import { describe, expect, it } from 'bun:test'
import { EPodResizeOutcome } from '@dltech/atlas-jobs/pod-resize'

import { runPodResize } from '../pod-resize-run'
import { depsOf, payload, sessionOf, WAIT_AT } from './pod-resize-fixture'

const waitingPayload = { ...payload, whenIdle: true }
const resumedPayload = { ...waitingPayload, waitedSince: '2026-11-25T09:00:00.000Z' }
const BUSY = { busy: true, running: ['2 shells'] }
const IDLE = { busy: false, running: [] }

const busyAnswers = (answers: readonly boolean[]) => {
  let index = 0
  return async () => ((answers[index++] ?? false) ? BUSY : IDLE)
}

describe('runPodResize waiting for the pod to go idle', () => {
  it('records the wait once and dispatches nothing more while the pod is busy', async () => {
    const { deps, resizes, wakes, waits, claims, started } = depsOf({ busy: async () => BUSY })

    expect(await runPodResize({ payload: waitingPayload, deps })).toEqual({
      outcome: EPodResizeOutcome.Waiting,
    })
    expect(waits).toEqual([{ sessionId: 'session-a', generation: 2, since: WAIT_AT }])
    expect(claims).toEqual([])
    expect(resizes).toEqual([])
    expect(wakes).toEqual([])
    expect(started).toEqual([])
  })

  it('resizes at once when the pod is idle, recording no wait', async () => {
    const { deps, resizes, waits, claims } = depsOf()

    expect(await runPodResize({ payload: waitingPayload, deps })).toEqual({
      outcome: EPodResizeOutcome.Applied,
    })
    expect(resizes).toEqual([{ sandboxSessionId: 'session-a', shape: { vcpus: 4, memoryGb: 16 } }])
    expect(waits).toEqual([])
    expect(claims).toEqual([])
  })

  it('takes its own wait back and resizes when the pod went idle while it recorded the wait', async () => {
    const { deps, resizes, waits, claims } = depsOf({ busy: busyAnswers([true, false]) })

    expect(await runPodResize({ payload: waitingPayload, deps })).toEqual({
      outcome: EPodResizeOutcome.Applied,
    })
    expect(waits).toEqual([{ sessionId: 'session-a', generation: 2, since: WAIT_AT }])
    expect(claims).toEqual([{ sessionId: 'session-a', generation: 2, since: WAIT_AT }])
    expect(resizes).toHaveLength(1)
  })

  it('leaves the resize to the run the idle push started when that run took the wait first', async () => {
    const { deps, resizes } = depsOf({
      busy: busyAnswers([true, false]),
      claimWait: async () => false,
    })

    expect(await runPodResize({ payload: waitingPayload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(resizes).toEqual([])
  })

  it('stops when a cancel or a newer resize cleared the wait before it was recorded', async () => {
    const { deps, resizes } = depsOf({
      busy: async () => BUSY,
      recordWaiting: async () => false,
    })

    expect(await runPodResize({ payload: waitingPayload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(resizes).toEqual([])
  })

  it('resizes at once when no wait was asked for, however busy the pod is', async () => {
    const { deps, resizes, waits } = depsOf({ busy: async () => BUSY })

    expect(await runPodResize({ payload, deps })).toEqual({ outcome: EPodResizeOutcome.Applied })
    expect(resizes).toHaveLength(1)
    expect(waits).toEqual([])
  })

  it('drops a waiting run a newer generation superseded before it saw the pod', async () => {
    const { deps, waits, resizes } = depsOf({
      session: async () => sessionOf({ podSizeGeneration: 3 }),
      busy: async () => BUSY,
    })

    expect(await runPodResize({ payload: waitingPayload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(waits).toEqual([])
    expect(resizes).toEqual([])
  })
})

describe('runPodResize resumed by the idle push', () => {
  it('claims the wait it was pushed for and resizes', async () => {
    const { deps, resizes, claims, waits } = depsOf()

    expect(await runPodResize({ payload: resumedPayload, deps })).toEqual({
      outcome: EPodResizeOutcome.Applied,
    })
    expect(claims).toEqual([
      { sessionId: 'session-a', generation: 2, since: '2026-11-25T09:00:00.000Z' },
    ])
    expect(waits).toEqual([])
    expect(resizes).toHaveLength(1)
  })

  it('does nothing when another run already claimed or a cancel cleared that wait', async () => {
    const { deps, resizes, started } = depsOf({ claimWait: async () => false })

    expect(await runPodResize({ payload: resumedPayload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(resizes).toEqual([])
    expect(started).toEqual([])
  })

  it('records a new wait when the pod went busy again before the run started', async () => {
    const { deps, resizes, waits } = depsOf({ busy: async () => BUSY })

    expect(await runPodResize({ payload: resumedPayload, deps })).toEqual({
      outcome: EPodResizeOutcome.Waiting,
    })
    expect(waits).toEqual([{ sessionId: 'session-a', generation: 2, since: WAIT_AT }])
    expect(resizes).toEqual([])
  })
})
