import { describe, expect, it } from 'bun:test'
import { EPodResizeOutcome } from './pod-resize.contract'
import { runPodResize, type PodResizeDeps, type PodResizeSession } from './pod-resize-run'

const CREDENTIALS = { token: 'user-token', teamId: 'team_1', projectId: 'prj_1' }

const sessionOf = (over: Partial<PodResizeSession> = {}): PodResizeSession => ({
  sessionId: 'session-a',
  userId: 'user-a',
  podSessionId: null,
  podSizeGeneration: 2,
  podDesiredVcpus: 4,
  ...over,
})

const depsOf = (over: Partial<PodResizeDeps> = {}) => {
  const resizes: { sandboxSessionId: string; vcpus: number }[] = []
  const failures: { sessionId: string; generation: number; error: string }[] = []
  const deps: PodResizeDeps = {
    session: async () => sessionOf(),
    credentials: async () => CREDENTIALS,
    resize: async (args) => {
      resizes.push({ sandboxSessionId: args.sandboxSessionId, vcpus: args.vcpus })
      return 'restarted'
    },
    recordFailed: async (args) => {
      failures.push(args)
    },
    ...over,
  }
  return { deps, resizes, failures }
}

const payload = { sessionId: 'session-a', generation: 2, vcpus: 4 }

describe('runPodResize', () => {
  it('stores the desired size on the session pod and reports the restart', async () => {
    const { deps, resizes } = depsOf()

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Applied,
    })
    expect(resizes).toEqual([{ sandboxSessionId: 'session-a', vcpus: 4 }])
  })

  it('exits when a newer generation superseded this one', async () => {
    const { deps, resizes } = depsOf({ session: async () => sessionOf({ podSizeGeneration: 3 }) })

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(resizes).toEqual([])
  })

  it('exits when the session is gone', async () => {
    const { deps } = depsOf({ session: async () => undefined })

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
  })

  it('resizes the shared parent pod of a sub-agent session', async () => {
    const { deps, resizes } = depsOf({
      session: async () => sessionOf({ podSessionId: 'parent-a' }),
    })

    await runPodResize({ payload, deps })

    expect(resizes).toEqual([{ sandboxSessionId: 'parent-a', vcpus: 4 }])
  })

  it('reports a stored size as such when the pod is parked', async () => {
    const { deps } = depsOf({ resize: async () => 'stored' })

    expect(await runPodResize({ payload, deps })).toEqual({ outcome: EPodResizeOutcome.Stored })
  })

  it('records the failure and rethrows when the apply fails', async () => {
    const { deps, failures } = depsOf({
      resize: async () => {
        throw new Error('sandbox refused the resize')
      },
    })

    await expect(runPodResize({ payload, deps })).rejects.toThrow('sandbox refused the resize')
    expect(failures).toEqual([
      { sessionId: 'session-a', generation: 2, error: 'sandbox refused the resize' },
    ])
  })
})
