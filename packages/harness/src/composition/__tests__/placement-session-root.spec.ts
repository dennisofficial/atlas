import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, EHarnessPlacement, toThreadId, type ThreadId } from '@dltech/atlas-core'

import { EPlacementMoveKind, PlacementController, PlacementBusy, type PlacementSessionAuthority } from '../placement-controller'
import { fakePlacementStore } from './placement-store-fake'

function setup(args: { authority?: PlacementSessionAuthority | undefined } = {}) {
  const threads = fakePlacementStore()
  const controller = new PlacementController(EExecutionLocation.Host)
  controller.bind({ threads, workspace: '/work', repo: '/repo', authority: args.authority })
  return { controller, threads }
}

const MAIN = toThreadId('session-main')
const SUCCESSOR = toThreadId('session-successor')
const CHILD = toThreadId('session-child')

function authorityOf({ active }: { active: ThreadId }): PlacementSessionAuthority & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    activeMainOf: async ({ sessionId }) => {
      calls.push(sessionId)
      return active
    },
  }
}

describe('placement session root resolution', () => {
  it('resolves the session through the authority, not supervision, for a supervised child', async () => {
    const authority = authorityOf({ active: MAIN })
    const { controller, threads } = setup({ authority })
    threads.seed({ threadId: MAIN, location: EExecutionLocation.Host })
    threads.seed({ threadId: CHILD, location: EExecutionLocation.Host, agent: { spawnedBy: MAIN, type: 'explore' } })

    await controller.activate({ threadId: MAIN })
    const first = controller.move({
      threadId: CHILD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async ({ commit }) => {
        await expect(
          controller.move({
            threadId: MAIN,
            target: EExecutionLocation.Cloud,
            kind: EPlacementMoveKind.Lift,
            work: async () => undefined,
          }),
        ).rejects.toBeInstanceOf(PlacementBusy)
        await commit({ harness: EHarnessPlacement.Cloud, driveName: 'drive' })
      },
    })
    await first
    expect(authority.calls).toEqual([CHILD, MAIN])
  })

  it('resolves a rotated session to its successor even when the predecessor is named', async () => {
    const authority = authorityOf({ active: SUCCESSOR })
    const { controller, threads } = setup({ authority })
    threads.seed({ threadId: MAIN, location: EExecutionLocation.Host })
    threads.seed({ threadId: SUCCESSOR, location: EExecutionLocation.Host })

    await controller.activate({ threadId: SUCCESSOR })
    await controller.move({
      threadId: MAIN,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async ({ commit }) => {
        await commit({ harness: EHarnessPlacement.Cloud, driveName: 'drive' })
      },
    })
    expect(authority.calls).toEqual([MAIN])
  })

  it('falls back to the supervision walk when the authority knows no session', async () => {
    const authority: PlacementSessionAuthority = { activeMainOf: async () => undefined }
    const { controller, threads } = setup({ authority })
    threads.seed({ threadId: MAIN, location: EExecutionLocation.Host })
    threads.seed({ threadId: CHILD, location: EExecutionLocation.Host, agent: { spawnedBy: MAIN, type: 'explore' } })

    await controller.activate({ threadId: MAIN })
    await controller.move({
      threadId: CHILD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async ({ commit }) => {
        await commit({ harness: EHarnessPlacement.Cloud, driveName: 'drive' })
      },
    })
  })

  it('keeps the supervision walk when no authority is bound at all', async () => {
    const { controller, threads } = setup()
    threads.seed({ threadId: MAIN, location: EExecutionLocation.Host })
    threads.seed({ threadId: CHILD, location: EExecutionLocation.Host, agent: { spawnedBy: MAIN, type: 'explore' } })

    await controller.activate({ threadId: MAIN })
    await controller.move({
      threadId: CHILD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async ({ commit }) => {
        await expect(
          controller.move({
            threadId: MAIN,
            target: EExecutionLocation.Cloud,
            kind: EPlacementMoveKind.Lift,
            work: async () => undefined,
          }),
        ).rejects.toBeInstanceOf(PlacementBusy)
        await commit({ harness: EHarnessPlacement.Cloud, driveName: 'drive' })
      },
    })
  })

  it('applies the same authority resolution to recovery', async () => {
    const authority = authorityOf({ active: MAIN })
    const { controller, threads } = setup({ authority })
    threads.seed({ threadId: MAIN, location: EExecutionLocation.Host })
    threads.seed({ threadId: CHILD, location: EExecutionLocation.Host, agent: { spawnedBy: MAIN, type: 'explore' } })

    await controller.activate({ threadId: MAIN })
    await controller.recover({ threadId: CHILD, reconcile: async (record) => record.placement })
    expect(authority.calls).toEqual([CHILD])
  })
})
