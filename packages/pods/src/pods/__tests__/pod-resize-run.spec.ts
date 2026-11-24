import { describe, expect, it } from 'bun:test'
import { EPodResizeOutcome } from '@dltech/atlas-jobs/pod-resize'
import {
  failureText,
  NO_SANDBOX_TO_RESIZE,
  POD_RESIZE_WAIT_SECONDS,
  runPodResize,
} from '../pod-resize-run'
import { depsOf, payload, sessionOf } from './pod-resize-fixture'

describe('runPodResize', () => {
  it('stores the desired size on the session pod, reports the restart and wakes it', async () => {
    const { deps, resizes, wakes } = depsOf()

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Applied,
    })
    expect(resizes).toEqual([{ sandboxSessionId: 'session-a', shape: { vcpus: 4, memoryGb: 16 } }])
    expect(wakes).toEqual([{ sessionId: 'session-a', epoch: 0 }])
  })

  it('resizes an archived session pod without waking it again', async () => {
    const { deps, resizes, wakes } = depsOf({
      session: async () => sessionOf({ archivedAt: '2026-11-23T01:43:02.832Z' }),
    })

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Applied,
    })
    expect(resizes).toHaveLength(1)
    expect(wakes).toEqual([])
  })

  it('resizes the disk the pod asked for beside the shape', async () => {
    const { deps, resizes } = depsOf({
      session: async () => sessionOf({ podDesiredDiskGb: 30 }),
    })

    await runPodResize({ payload, deps })

    expect(resizes).toEqual([
      { sandboxSessionId: 'session-a', shape: { vcpus: 4, memoryGb: 16 }, diskGb: 30 },
    ])
  })

  it('falls back to the disk the payload carried when the pod recorded none', async () => {
    const { deps, resizes } = depsOf()

    await runPodResize({ payload: { ...payload, diskGb: 40 }, deps })

    expect(resizes).toEqual([
      { sandboxSessionId: 'session-a', shape: { vcpus: 4, memoryGb: 16 }, diskGb: 40 },
    ])
  })

  it('records the applied size itself when the provider recreated the container', async () => {
    const { deps, applied, wakes } = depsOf()

    await runPodResize({ payload, deps })

    expect(applied).toEqual([{ sessionId: 'session-a', vcpus: 4, memoryGb: 16, generation: 2 }])
    expect(wakes).toEqual([{ sessionId: 'session-a', epoch: 0 }])
  })

  it('records the applied size on the shared parent pod a sub-agent session resized', async () => {
    const { deps, applied } = depsOf({
      session: async () => sessionOf({ podSessionId: 'parent-a' }),
    })

    await runPodResize({ payload, deps })

    expect(applied).toEqual([{ sessionId: 'parent-a', vcpus: 4, memoryGb: 16, generation: 2 }])
  })

  it('exits when a newer generation superseded this one', async () => {
    const { deps, resizes, wakes } = depsOf({
      session: async () => sessionOf({ podSizeGeneration: 3 }),
    })

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(resizes).toEqual([])
    expect(wakes).toEqual([])
  })

  it('exits when the session is gone', async () => {
    const { deps, wakes } = depsOf({ session: async () => undefined })

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(wakes).toEqual([])
  })

  it('resizes and wakes the shared parent pod of a sub-agent session', async () => {
    const { deps, resizes, wakes } = depsOf({
      session: async () => sessionOf({ podSessionId: 'parent-a' }),
    })

    await runPodResize({ payload, deps })

    expect(resizes).toEqual([{ sandboxSessionId: 'parent-a', shape: { vcpus: 4, memoryGb: 16 } }])
    expect(wakes).toEqual([{ sessionId: 'parent-a', epoch: 0 }])
  })

  it('defers a stored size on a parked pod and leaves it asleep', async () => {
    const { deps, failures, wakes } = depsOf({ resize: async () => 'stored' })

    expect(await runPodResize({ payload, deps })).toEqual({ outcome: EPodResizeOutcome.Deferred })
    expect(wakes).toEqual([])
    expect(failures).toEqual([])
  })

  it('leaves a held pod to its holder instead of revoking its lease', async () => {
    const { deps, applied, wakes, heldIds } = depsOf({ resize: async () => 'stored' })
    heldIds.add('session-a')

    expect(await runPodResize({ payload, deps })).toEqual({ outcome: EPodResizeOutcome.Applied })
    expect(wakes).toEqual([])
    // a stored size is applied by the wake that follows, which is where it gets recorded
    expect(applied).toEqual([])
  })

  it('fails a resize with no sandbox to resize and records the error', async () => {
    const { deps, failures, wakes } = depsOf({ resize: async () => 'absent' })

    expect(await runPodResize({ payload, deps })).toEqual({ outcome: EPodResizeOutcome.Failed })
    expect(failures).toEqual([
      { sessionId: 'session-a', generation: 2, error: NO_SANDBOX_TO_RESIZE },
    ])
    expect(wakes).toEqual([])
  })

  it('records nothing for a deferred resize', async () => {
    const { deps, applied, failures } = depsOf({ resize: async () => 'stored' })

    await runPodResize({ payload, deps })

    expect(applied).toEqual([])
    expect(failures).toEqual([])
  })

  it('rethrows the apply failure without recording it or rewaking', async () => {
    const { deps, applied, failures, wakes } = depsOf({
      resize: async () => {
        throw new Error('sandbox refused the resize')
      },
    })

    await expect(runPodResize({ payload, deps })).rejects.toThrow('sandbox refused the resize')
    expect(applied).toEqual([])
    expect(failures).toEqual([])
    expect(wakes).toEqual([])
  })
})

describe('runPodResize waiting for the pod to go idle', () => {
  const waitingPayload = {
    sessionId: 'session-a',
    generation: 2,
    vcpus: 4,
    memoryGb: 16,
    whenIdle: true,
  }

  it('requeues itself instead of resizing while the pod is busy, and marks the wait', async () => {
    const { deps, resizes, wakes, requeues, waits } = depsOf({
      busy: async () => ({ busy: true, running: ['2 shells'] }),
    })

    expect(await runPodResize({ payload: waitingPayload, deps })).toEqual({
      outcome: EPodResizeOutcome.Waiting,
    })
    expect(waits).toEqual([{ sessionId: 'session-a', generation: 2 }])
    expect(resizes).toEqual([])
    expect(wakes).toEqual([])
    expect(requeues).toEqual([{ payload: waitingPayload, delaySeconds: POD_RESIZE_WAIT_SECONDS }])
  })

  it('resizes once the pod is idle, marking no wait', async () => {
    const { deps, resizes, requeues, waits } = depsOf()

    expect(await runPodResize({ payload: waitingPayload, deps })).toEqual({
      outcome: EPodResizeOutcome.Applied,
    })
    expect(resizes).toEqual([{ sandboxSessionId: 'session-a', shape: { vcpus: 4, memoryGb: 16 } }])
    expect(requeues).toEqual([])
    expect(waits).toEqual([])
  })

  it('resizes at once when no wait was asked for, however busy the pod is', async () => {
    const { deps, resizes, requeues } = depsOf({
      busy: async () => ({ busy: true, running: ['Agent turn'] }),
    })

    expect(await runPodResize({ payload, deps })).toEqual({ outcome: EPodResizeOutcome.Applied })
    expect(resizes).toEqual([{ sandboxSessionId: 'session-a', shape: { vcpus: 4, memoryGb: 16 } }])
    expect(requeues).toEqual([])
  })

  it('drops a waiting run a newer generation superseded before it saw the pod', async () => {
    const { deps, requeues, resizes } = depsOf({
      session: async () => sessionOf({ podSizeGeneration: 3 }),
      busy: async () => ({ busy: true, running: ['2 shells'] }),
    })

    expect(await runPodResize({ payload: waitingPayload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(requeues).toEqual([])
    expect(resizes).toEqual([])
  })
})

describe('failureText', () => {
  it('reads the message of an error and the text of anything else', () => {
    expect(failureText(new Error('sandbox refused the resize'))).toBe('sandbox refused the resize')
    expect(failureText('sandbox_stopping')).toBe('sandbox_stopping')
  })
})
