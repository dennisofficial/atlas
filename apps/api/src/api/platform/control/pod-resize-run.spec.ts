import { describe, expect, it } from 'bun:test'
import { EPodResizeOutcome } from './pod-resize.contract'
import {
  failureText,
  NO_SANDBOX_TO_RESIZE,
  runPodResize,
  type PodResizeDeps,
  type PodResizeSession,
} from './pod-resize-run'

const sessionOf = (over: Partial<PodResizeSession> = {}): PodResizeSession => ({
  sessionId: 'session-a',
  podSessionId: null,
  podSizeGeneration: 2,
  podDesiredVcpus: 4,
  ...over,
})

const depsOf = (over: Partial<PodResizeDeps> = {}) => {
  const resizes: { sandboxSessionId: string; vcpus: number }[] = []
  const rewakes: { sessionId: string }[] = []
  const applied: { sessionId: string; vcpus: number; generation: number }[] = []
  const failures: { sessionId: string; generation: number; error: string }[] = []
  const deps: PodResizeDeps = {
    session: async () => sessionOf(),
    resize: async (args) => {
      resizes.push({ sandboxSessionId: args.sandboxSessionId, vcpus: args.vcpus })
      return 'restarted'
    },
    rewake: async (args) => {
      rewakes.push(args)
    },
    held: async () => false,
    recordApplied: async (args) => {
      applied.push(args)
    },
    recordFailed: async (args) => {
      failures.push(args)
    },
    ...over,
  }
  return { deps, resizes, rewakes, applied, failures }
}

const payload = { sessionId: 'session-a', generation: 2, vcpus: 4 }

describe('runPodResize', () => {
  it('stores the desired size on the session pod, reports the restart and rewakes it', async () => {
    const { deps, resizes, rewakes } = depsOf()

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Applied,
    })
    expect(resizes).toEqual([{ sandboxSessionId: 'session-a', vcpus: 4 }])
    expect(rewakes).toEqual([{ sessionId: 'session-a' }])
  })

  it('records the applied size itself when the provider recreated the container', async () => {
    const { deps, applied, rewakes } = depsOf()

    await runPodResize({ payload, deps })

    expect(applied).toEqual([{ sessionId: 'session-a', vcpus: 4, generation: 2 }])
    expect(rewakes).toEqual([{ sessionId: 'session-a' }])
  })

  it('records the applied size on the shared parent pod a sub-agent session resized', async () => {
    const { deps, applied } = depsOf({
      session: async () => sessionOf({ podSessionId: 'parent-a' }),
    })

    await runPodResize({ payload, deps })

    expect(applied).toEqual([{ sessionId: 'parent-a', vcpus: 4, generation: 2 }])
  })

  it('exits when a newer generation superseded this one', async () => {
    const { deps, resizes, rewakes } = depsOf({
      session: async () => sessionOf({ podSizeGeneration: 3 }),
    })

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(resizes).toEqual([])
    expect(rewakes).toEqual([])
  })

  it('exits when the session is gone', async () => {
    const { deps, rewakes } = depsOf({ session: async () => undefined })

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(rewakes).toEqual([])
  })

  it('resizes and rewakes the shared parent pod of a sub-agent session', async () => {
    const { deps, resizes, rewakes } = depsOf({
      session: async () => sessionOf({ podSessionId: 'parent-a' }),
    })

    await runPodResize({ payload, deps })

    expect(resizes).toEqual([{ sandboxSessionId: 'parent-a', vcpus: 4 }])
    expect(rewakes).toEqual([{ sessionId: 'parent-a' }])
  })

  it('defers a stored size on a parked pod and leaves it asleep', async () => {
    const { deps, failures, rewakes } = depsOf({ resize: async () => 'stored' })

    expect(await runPodResize({ payload, deps })).toEqual({ outcome: EPodResizeOutcome.Deferred })
    expect(rewakes).toEqual([])
    expect(failures).toEqual([])
  })

  it('rewakes a pod a retry finds already stopped while a host still holds it', async () => {
    const { deps, applied, rewakes } = depsOf({
      resize: async () => 'stored',
      held: async () => true,
    })

    expect(await runPodResize({ payload, deps })).toEqual({ outcome: EPodResizeOutcome.Applied })
    expect(rewakes).toEqual([{ sessionId: 'session-a' }])
    // a stored size is applied by the wake that follows, which is where it gets recorded
    expect(applied).toEqual([])
  })

  it('fails a resize with no sandbox to resize and records the error', async () => {
    const { deps, failures, rewakes } = depsOf({ resize: async () => 'absent' })

    expect(await runPodResize({ payload, deps })).toEqual({ outcome: EPodResizeOutcome.Failed })
    expect(failures).toEqual([
      { sessionId: 'session-a', generation: 2, error: NO_SANDBOX_TO_RESIZE },
    ])
    expect(rewakes).toEqual([])
  })

  it('records nothing for a deferred resize', async () => {
    const { deps, applied, failures } = depsOf({ resize: async () => 'stored' })

    await runPodResize({ payload, deps })

    expect(applied).toEqual([])
    expect(failures).toEqual([])
  })

  it('rethrows the apply failure without recording it or rewaking', async () => {
    const { deps, applied, failures, rewakes } = depsOf({
      resize: async () => {
        throw new Error('sandbox refused the resize')
      },
    })

    await expect(runPodResize({ payload, deps })).rejects.toThrow('sandbox refused the resize')
    expect(applied).toEqual([])
    expect(failures).toEqual([])
    expect(rewakes).toEqual([])
  })
})

describe('failureText', () => {
  it('reads the message of an error and the text of anything else', () => {
    expect(failureText(new Error('sandbox refused the resize'))).toBe('sandbox refused the resize')
    expect(failureText('sandbox_stopping')).toBe('sandbox_stopping')
  })
})
