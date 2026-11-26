import { describe, expect, it } from 'bun:test'
import { EPodResizeOutcome } from '@dltech/atlas-jobs/pod-resize'
import { AGENT37_RESIZE_BUDGET_MS } from '../../sandbox/agent37/agent37-resize'
import {
  failureText,
  NO_SANDBOX_TO_RESIZE,
  POD_RESIZE_MAX_DURATION_SECONDS,
  runPodResize,
} from '../pod-resize-run'
import { POD_RESIZE_STARTED_WAIT_MS } from '../pod-resize-interrupt'
import { depsOf, payload, sessionOf } from './pod-resize-fixture'

describe('runPodResize', () => {
  it('stores the desired size on the session pod, reports the restart and wakes it', async () => {
    const { deps, resizes, wakes, parks } = depsOf()

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Applied,
    })
    expect(resizes).toEqual([{ sandboxSessionId: 'session-a', shape: { vcpus: 4, memoryGb: 16 } }])
    expect(wakes).toEqual([{ sessionId: 'session-a', epoch: 0 }])
    expect(parks).toEqual([])
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

  it('records the size a pod already runs at as applied, without waking it', async () => {
    const { deps, applied, failures, wakes } = depsOf({ resize: async () => 'unchanged' })

    expect(await runPodResize({ payload, deps })).toEqual({ outcome: EPodResizeOutcome.Applied })
    expect(applied).toEqual([{ sessionId: 'session-a', vcpus: 4, memoryGb: 16, generation: 2 }])
    expect(failures).toEqual([])
    expect(wakes).toEqual([])
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

describe('runPodResize of a sleeping pod', () => {
  it('resizes it and parks it again instead of waking it', async () => {
    const { deps, resizes, wakes, parks } = depsOf({
      session: async () => sessionOf({ sandboxStatus: 'sleeping' }),
    })

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Applied,
    })
    expect(resizes).toHaveLength(1)
    expect(wakes).toEqual([])
    expect(parks).toEqual([{ sandboxSessionId: 'session-a' }])
  })

  it('parks a stopped pod the provider has not named asleep yet', async () => {
    const { deps, wakes, parks } = depsOf({
      session: async () => sessionOf({ sandboxStatus: 'stopped' }),
    })

    await runPodResize({ payload, deps })

    expect(wakes).toEqual([])
    expect(parks).toEqual([{ sandboxSessionId: 'session-a' }])
  })

  it('parks a pod the operator stopped before the provider reported it asleep', async () => {
    const { deps, wakes, parks } = depsOf({
      session: async () =>
        sessionOf({ sandboxStatus: 'running', podParkedAt: '2026-11-26T10:00:00.000Z' }),
    })

    await runPodResize({ payload, deps })

    expect(wakes).toEqual([])
    expect(parks).toEqual([{ sandboxSessionId: 'session-a' }])
  })

  it('wakes a pod that was running when the resize arrived', async () => {
    const { deps, wakes, parks } = depsOf({
      session: async () => sessionOf({ sandboxStatus: 'running' }),
    })

    await runPodResize({ payload, deps })

    expect(wakes).toEqual([{ sessionId: 'session-a', epoch: 0 }])
    expect(parks).toEqual([])
  })
})

describe('POD_RESIZE_MAX_DURATION_SECONDS', () => {
  it('outlasts the slowest resize agent37 can answer, so a provider timeout fails the run first', () => {
    expect(POD_RESIZE_MAX_DURATION_SECONDS * 1000).toBeGreaterThan(
      POD_RESIZE_STARTED_WAIT_MS + AGENT37_RESIZE_BUDGET_MS,
    )
  })
})

describe('failureText', () => {
  it('reads the message of an error and the text of anything else', () => {
    expect(failureText(new Error('sandbox refused the resize'))).toBe('sandbox refused the resize')
    expect(failureText('sandbox_stopping')).toBe('sandbox_stopping')
  })
})
