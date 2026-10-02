import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, EPlacementMovePhase, EHarnessPlacement, toThreadId } from '@dltech/atlas-core'

import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { EPlacementMoveKind, PlacementController } from '../placement-controller'

const held: StoreFixture[] = []
afterEach(async () => {
  for (const fixture of held.splice(0)) await fixture.close()
})

function setup() {
  const fixture = openStoreFixture()
  held.push(fixture)
  const controller = new PlacementController(EExecutionLocation.Host)
  controller.bind({ threads: fixture.threads, workspace: '/work', repo: '/repo' })
  return { ...fixture, controller }
}

const THREAD = toThreadId('placement-session')

describe('session placement', () => {
  it('keeps the source pill during preparation and publishes only a durable commit', async () => {
    const { controller, threads } = setup()
    await controller.activate({ threadId: THREAD })
    await controller.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async ({ commit }) => {
        expect(controller.current()).toBe(EExecutionLocation.Host)
        expect((await threads.readPlacement({ threadId: THREAD }))?.move?.phase).toBe(EPlacementMovePhase.Preparing)
        await commit({ harness: EHarnessPlacement.Cloud, driveName: 'session-drive' })
        expect((await threads.readPlacement({ threadId: THREAD }))?.placement).toEqual({ harness: EHarnessPlacement.Cloud, driveName: 'session-drive' })
        expect(controller.current()).toBe(EExecutionLocation.Cloud)
      },
    })
    expect(controller.snapshot(THREAD)?.move).toBeNull()
  })

  it('survives a client failure after ownership transferred without changing cloud to host', async () => {
    const { controller, reopen } = setup()
    await controller.activate({ threadId: THREAD })
    await expect(controller.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async ({ commit }) => {
        await commit()
        throw new Error('client socket disappeared')
      },
    })).rejects.toThrow('client socket disappeared')
    const rebuilt = await reopen()
    const next = new PlacementController(EExecutionLocation.Host)
    next.bind({ threads: rebuilt.threads, workspace: '/work', repo: '/repo' })
    await next.activate({ threadId: THREAD })
    expect(next.current()).toBe(EExecutionLocation.Cloud)
    expect(next.snapshot(THREAD)?.move?.phase).toBe(EPlacementMovePhase.Committed)
    await next.recover({ threadId: THREAD, reconcile: async (record) => record.placement })
    expect(next.current()).toBe(EExecutionLocation.Cloud)
    expect(next.snapshot(THREAD)?.move).toBeNull()
  })

  it('preserves source placement when preparation fails', async () => {
    const { controller } = setup()
    await controller.activate({ threadId: THREAD })
    await expect(controller.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async () => { throw new Error('upload refused') },
    })).rejects.toThrow('upload refused')
    expect(controller.current()).toBe(EExecutionLocation.Host)
    expect(controller.snapshot(THREAD)?.move).toBeNull()
  })

  it('surfaces the move to readers from its first durable write until it settles', async () => {
    const { controller } = setup()
    await controller.activate({ threadId: THREAD })
    let release: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => { release = resolve })
    let entered: () => void = () => undefined
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const seen: boolean[] = []
    const unsubscribe = controller.subscribe(() => {
      seen.push(controller.moveFor(THREAD) !== null)
    })
    const pending = controller.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async ({ commit }) => {
        entered()
        expect(controller.moveFor(THREAD)?.phase).toBe(EPlacementMovePhase.Preparing)
        await waiting
        await commit()
        expect(controller.moveFor(THREAD)?.phase).toBe(EPlacementMovePhase.Committed)
      },
    })
    await ready
    expect(controller.moveFor(THREAD)?.phase).toBe(EPlacementMovePhase.Preparing)
    release()
    await pending
    unsubscribe()
    expect(controller.moveFor(THREAD)).toBeNull()
    expect(seen).toContain(true)
    expect(seen[seen.length - 1]).toBe(false)
  })

  it('refuses overlapping moves across the session and its teammate', async () => {
    const { controller, threads } = setup()
    await threads.create({ id: THREAD })
    const peer = await threads.create({ agent: { spawnedBy: THREAD, type: 'teammate' } })
    let release: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => { release = resolve })
    let entered: () => void = () => undefined
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const first = controller.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async ({ commit }) => { entered(); await waiting; await commit() },
    })
    await ready
    await expect(controller.move({
      threadId: peer.id,
      target: EExecutionLocation.Docker,
      kind: EPlacementMoveKind.Tools,
      work: async ({ commit }) => commit(),
    })).rejects.toThrow('already underway')
    release()
    await first
  })

  it('does not change the main session indicator when a teammate switches tools', async () => {
    const { controller, threads } = setup()
    await threads.create({ id: THREAD })
    const peer = await threads.create({ agent: { spawnedBy: THREAD, type: 'teammate' } })
    await controller.activate({ threadId: THREAD })
    await controller.move({ threadId: peer.id, target: EExecutionLocation.Docker, kind: EPlacementMoveKind.Tools, work: async ({ commit }) => commit() })
    expect(controller.current()).toBe(EExecutionLocation.Host)
    expect(controller.of(peer.id)).toBe(EExecutionLocation.Docker)
  })

  it('clears the preparation marker and keeps the source when the work abandons the move', async () => {
    const { controller, threads } = setup()
    await controller.activate({ threadId: THREAD })
    const outcome = await controller.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async ({ abandon }) => {
        expect((await threads.readPlacement({ threadId: THREAD }))?.move?.phase).toBe(EPlacementMovePhase.Preparing)
        abandon()
        return { ok: false as const }
      },
    })
    expect(outcome).toEqual({ ok: false })
    expect(controller.current()).toBe(EExecutionLocation.Host)
    expect(controller.snapshot(THREAD)?.move).toBeNull()
  })

  it('refuses tool environment changes in a cloud harness', async () => {
    const { controller } = setup()
    await controller.activate({ threadId: THREAD })
    await controller.move({ threadId: THREAD, target: EExecutionLocation.Cloud, kind: EPlacementMoveKind.Lift, work: async ({ commit }) => commit() })
    await expect(controller.move({ threadId: THREAD, target: EExecutionLocation.Docker, kind: EPlacementMoveKind.Tools, work: async ({ commit }) => commit() })).rejects.toThrow('cloud harnesses cannot')
  })
})
