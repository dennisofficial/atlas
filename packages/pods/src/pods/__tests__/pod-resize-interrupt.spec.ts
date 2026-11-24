import { describe, expect, it } from 'bun:test'
import { EPodResizeOutcome } from '@dltech/atlas-jobs/pod-resize'
import { NO_SANDBOX_TO_RESIZE, type PodResizeDeps, runPodResize } from '../pod-resize-run'
import { depsOf, payload } from './pod-resize-fixture'

describe('runPodResize announcing the resize to the agents on the pod', () => {
  const heldPeer = () =>
    depsOf({
      placed: async (args) => [
        { sessionId: args.podSessionId, archivedAt: null },
        { sessionId: 'agent-builder', archivedAt: null },
      ],
    })

  it('tells every held session before it resizes, and waits for the consumption', async () => {
    const rig = heldPeer()
    rig.heldIds.add('session-a')
    rig.heldIds.add('agent-builder')
    const order: string[] = []
    const deps = {
      ...rig.deps,
      resize: async (args: Parameters<PodResizeDeps['resize']>[0]) => {
        order.push(`resize ${args.sandboxSessionId}`)
        return 'restarted' as const
      },
    }
    let checked = 0
    const started = rig.deps.started
    const counted = {
      ...deps,
      started: async (args: Parameters<PodResizeDeps['started']>[0]) => {
        order.push(`started ${args.sessionId}`)
        return started(args)
      },
      consumed: async () => {
        checked += 1
        return checked > 2
      },
    }

    await runPodResize({ payload, deps: counted })

    expect(order).toEqual(['started session-a', 'started agent-builder', 'resize session-a'])
    expect(rig.started).toEqual([
      { sessionId: 'session-a', vcpus: 4, memoryGb: 16, generation: 2 },
      { sessionId: 'agent-builder', vcpus: 4, memoryGb: 16, generation: 2 },
    ])
    expect(rig.sleeps.length).toBeGreaterThan(0)
  })

  it('leaves the started record for the next holder and resizes anyway', async () => {
    const rig = heldPeer()
    rig.heldIds.add('agent-builder')

    expect(await runPodResize({ payload, deps: rig.deps })).toEqual({
      outcome: EPodResizeOutcome.Applied,
    })
    expect(rig.started).toEqual([
      { sessionId: 'agent-builder', vcpus: 4, memoryGb: 16, generation: 2 },
    ])
    expect(rig.sleeps).toHaveLength(20)
    expect(rig.resizes).toHaveLength(1)
  })

  it('does not tell or revoke an unheld session', async () => {
    const { deps, started, wakes } = depsOf()

    await runPodResize({ payload, deps })

    expect(started).toEqual([])
    expect(wakes).toEqual([{ sessionId: 'session-a', epoch: 0 }])
  })

  it('tells every unarchived session the new size after the resize', async () => {
    const rig = heldPeer()
    rig.heldIds.add('session-a')

    await runPodResize({ payload, deps: rig.deps })

    expect(rig.notices).toEqual([
      {
        sessionId: 'session-a',
        notice: { vcpus: 4, memoryGb: 16, generation: 2, outcome: 'applied' },
      },
      {
        sessionId: 'agent-builder',
        notice: { vcpus: 4, memoryGb: 16, generation: 2, outcome: 'applied' },
      },
    ])
  })

  it('tells the sessions the resize failed and keeps their size', async () => {
    const rig = heldPeer()

    expect(
      await runPodResize({
        payload,
        deps: { ...rig.deps, resize: async () => 'absent' as const },
      }),
    ).toEqual({ outcome: EPodResizeOutcome.Failed })
    expect(rig.notices).toEqual([
      {
        sessionId: 'session-a',
        notice: {
          vcpus: 4,
          memoryGb: 16,
          generation: 2,
          outcome: 'failed',
          error: NO_SANDBOX_TO_RESIZE,
        },
      },
      {
        sessionId: 'agent-builder',
        notice: {
          vcpus: 4,
          memoryGb: 16,
          generation: 2,
          outcome: 'failed',
          error: NO_SANDBOX_TO_RESIZE,
        },
      },
    ])
  })

  it('tells the sessions a thrown resize failed before it rethrows', async () => {
    const rig = heldPeer()

    await expect(
      runPodResize({
        payload,
        deps: {
          ...rig.deps,
          resize: async () => {
            throw new Error('sandbox refused the resize')
          },
        },
      }),
    ).rejects.toThrow('sandbox refused the resize')
    expect(rig.notices).toEqual([
      {
        sessionId: 'session-a',
        notice: {
          vcpus: 4,
          memoryGb: 16,
          generation: 2,
          outcome: 'failed',
          error: 'sandbox refused the resize',
        },
      },
      {
        sessionId: 'agent-builder',
        notice: {
          vcpus: 4,
          memoryGb: 16,
          generation: 2,
          outcome: 'failed',
          error: 'sandbox refused the resize',
        },
      },
    ])
  })
})

describe('runPodResize waking the pod it did not tell', () => {
  it('wakes with the epoch it read before the resize', async () => {
    const { deps, wakes, epochs } = depsOf()
    epochs.set('session-a', 7)

    await runPodResize({ payload, deps })

    expect(wakes).toEqual([{ sessionId: 'session-a', epoch: 7 }])
  })

  it('does not revoke a session that was claimed again while the resize ran', async () => {
    const rig = depsOf()
    rig.epochs.set('session-a', 3)
    const current = new Map([['session-a', 3]])
    const revoked: string[] = []
    const deps = {
      ...rig.deps,
      resize: async () => {
        current.set('session-a', 4)
        return 'restarted' as const
      },
      wake: async (args: { sessionId: string; epoch: number }) => {
        if (current.get(args.sessionId) !== args.epoch) return
        revoked.push(args.sessionId)
      },
    }

    expect(await runPodResize({ payload, deps })).toEqual({ outcome: EPodResizeOutcome.Applied })
    expect(revoked).toEqual([])
  })

  it('wakes the pod when no claim happened in between', async () => {
    const rig = depsOf()
    rig.epochs.set('session-a', 3)
    const current = new Map([['session-a', 3]])
    const revoked: string[] = []
    const deps = {
      ...rig.deps,
      wake: async (args: { sessionId: string; epoch: number }) => {
        if (current.get(args.sessionId) !== args.epoch) return
        revoked.push(args.sessionId)
      },
    }

    await runPodResize({ payload, deps })

    expect(revoked).toEqual(['session-a'])
  })
})
