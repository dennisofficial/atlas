import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, EPlacementMovePhase, placementOf, toThreadId, type PlacementRecord } from '@dltech/atlas-core'

import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { EPlacementMoveKind, PlacementController } from '../placement-controller'
import { recoveryActionOf, ERecoveryAction } from '../session-recovery'
import { createSessionOwner, ERuntimeKind, type RuntimeBinding } from '../session-owner'

type Adapters = { name: string }

const held: StoreFixture[] = []
afterEach(async () => {
  for (const fixture of held.splice(0)) await fixture.close()
})

const THREAD = toThreadId('owned-session')

const binding = (args: { kind: ERuntimeKind; name: string; cwd: string }): RuntimeBinding<Adapters> & { closed: number } => {
  const made = {
    kind: args.kind,
    cwd: args.cwd,
    adapters: { name: args.name },
    closed: 0,
    close: () => {
      made.closed += 1
    },
  }
  return made
}

async function setup() {
  const fixture = openStoreFixture()
  held.push(fixture)
  const placement = new PlacementController(EExecutionLocation.Host)
  placement.bind({ threads: fixture.threads, workspace: '/work', repo: '/repo' })
  const local = binding({ kind: ERuntimeKind.Local, name: 'local', cwd: '/work' })
  const owner = createSessionOwner<Adapters>({ placement, local })
  await owner.placement.activate({ threadId: THREAD })
  const seen: { location: EExecutionLocation; name: string; bound: boolean }[] = []
  owner.subscribe(() => {
    const view = owner.snapshot()
    seen.push({ location: view.location, name: view.binding?.adapters.name ?? 'none', bound: view.bound })
  })
  return { owner, local, seen, placement }
}

const cloudBinding = () => binding({ kind: ERuntimeKind.Cloud, name: 'cloud', cwd: '/sandbox' })

describe('session owner recovery and freezes', () => {
  it('recovers a committed move from the persisted placement, attaching before the record clears', async () => {
    const { owner, placement } = await setup()
    await expect(owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(cloudBinding())
        await transaction.commit()
        throw new Error('process died')
      },
    })).rejects.toThrow('process died')
    owner.detach({ threadId: THREAD })
    placement.snapshot(THREAD)

    await expect(owner.recover({ threadId: THREAD })).rejects.toThrow('could not be prepared')
    expect(owner.snapshot().bound).toBe(false)

    const reattached = cloudBinding()
    const actions: string[] = []
    const record = await owner.recover({ threadId: THREAD, prepare: async ({ action }) => { actions.push(action); return reattached } })
    expect(actions).toEqual(['activate-cloud'])
    expect(record.move).toBeNull()
    expect(owner.require()).toBe(reattached)
  })

  it('installs the prepared runtime when the durable write persisted the commit but then threw', async () => {
    const fixture = openStoreFixture()
    held.push(fixture)
    let armed = false
    const threads = {
      ...fixture.threads,
      readPlacement: fixture.threads.readPlacement.bind(fixture.threads),
      onPlacementChanged: fixture.threads.onPlacementChanged.bind(fixture.threads),
      find: fixture.threads.find.bind(fixture.threads),
      writePlacement: async (write: Parameters<typeof fixture.threads.writePlacement>[0]) => {
        await fixture.threads.writePlacement(write)
        if (armed && write.record.move?.phase === 'committed') throw new Error('session meta mirror failed')
      },
    }
    const placement = new PlacementController(EExecutionLocation.Host)
    placement.bind({ threads, workspace: '/work', repo: '/repo' })
    const owner = createSessionOwner<Adapters>({ placement, local: binding({ kind: ERuntimeKind.Local, name: 'local', cwd: '/work' }) })
    await owner.placement.activate({ threadId: THREAD })
    armed = true
    const cloud = cloudBinding()
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(cloud)
        await transaction.commit()
        expect(transaction.committed()).toBe(true)
      },
    })
    expect(owner.snapshot().location).toBe(EExecutionLocation.Cloud)
    expect(owner.require()).toBe(cloud)
  })

  it('freezes the source family for a lift, releasing on failure and holding until the descend commits', async () => {
    const { owner, local } = await setup()
    const holds: string[] = []
    local.freeze = async ({ threadId }) => {
      holds.push(`hold:${threadId}`)
      return () => holds.push('release')
    }
    await expect(owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async () => {
        throw new Error('stopped before commit')
      },
    })).rejects.toThrow('stopped before commit')
    expect(holds).toEqual([`hold:${THREAD}`, 'release'])

    holds.length = 0
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(cloudBinding())
        await transaction.commit()
      },
    })
    expect(holds).toEqual([`hold:${THREAD}`])

    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Host,
      kind: EPlacementMoveKind.Descend,
      work: async (transaction) => transaction.commit(),
    })
    expect(holds).toEqual([`hold:${THREAD}`, 'release'])
  })

  it('refuses to adopt over an unfinished move, then clears it only after the settle step ran', async () => {
    const { owner, placement } = await setup()
    await expect(owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(cloudBinding())
        await transaction.commit()
        throw new Error('process died')
      },
    })).rejects.toThrow('process died')
    owner.detach({ threadId: THREAD })
    expect(placement.snapshot(THREAD)?.move).not.toBeNull()

    const refused = cloudBinding()
    await expect(owner.adopt({ threadId: THREAD, binding: refused })).rejects.toThrow('unfinished move')
    expect(placement.snapshot(THREAD)?.move).not.toBeNull()

    const failing = cloudBinding()
    await expect(owner.adopt({
      threadId: THREAD,
      binding: failing,
      settle: async () => {
        throw new Error('the sandbox would not activate')
      },
    })).rejects.toThrow('would not activate')
    expect(failing.closed).toBe(1)
    expect(placement.snapshot(THREAD)?.move).not.toBeNull()
    expect(owner.snapshot().bound).toBe(false)

    const actions: string[] = []
    const reattached = cloudBinding()
    await owner.adopt({
      threadId: THREAD,
      binding: reattached,
      settle: async ({ action }) => {
        actions.push(action)
      },
    })
    expect(actions).toEqual(['activate-cloud'])
    expect(placement.snapshot(THREAD)?.move).toBeNull()
    expect(owner.require()).toBe(reattached)
  })

  it('chooses the recovery action from the persisted move phase and destination', () => {
    const record = (args: { phase: EPlacementMovePhase; at: EExecutionLocation }): PlacementRecord => ({
      placement: placementOf(args.at),
      revision: 3,
      move: { id: 'm', from: placementOf(EExecutionLocation.Host), to: placementOf(EExecutionLocation.Cloud), phase: args.phase },
    })
    expect(recoveryActionOf({ placement: placementOf(EExecutionLocation.Host), revision: 1, move: null })).toBe(ERecoveryAction.None)
    expect(recoveryActionOf(record({ phase: EPlacementMovePhase.Preparing, at: EExecutionLocation.Cloud }))).toBe(ERecoveryAction.ResumeSource)
    expect(recoveryActionOf(record({ phase: EPlacementMovePhase.Preparing, at: EExecutionLocation.Host }))).toBe(ERecoveryAction.KeepSource)
    expect(recoveryActionOf(record({ phase: EPlacementMovePhase.Committed, at: EExecutionLocation.Cloud }))).toBe(ERecoveryAction.ActivateCloud)
    expect(recoveryActionOf(record({ phase: EPlacementMovePhase.Committed, at: EExecutionLocation.Host }))).toBe(ERecoveryAction.BindLocal)
  })

  it('keeps the source family frozen across a detach while the placement is cloud, keyed by thread', async () => {
    const { owner, local } = await setup()
    const holds: string[] = []
    local.freeze = async ({ threadId }) => {
      holds.push(`hold:${threadId}`)
      return () => holds.push(`release:${threadId}`)
    }
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(cloudBinding())
        await transaction.commit()
      },
    })
    owner.detach({ threadId: THREAD })
    expect(holds).toEqual([`hold:${THREAD}`])

    const other = toThreadId('another-session')
    await owner.activateLocal({ threadId: other })
    expect(holds).toEqual([`hold:${THREAD}`])

    await owner.adopt({ threadId: THREAD, binding: cloudBinding() })
    expect(holds).toEqual([`hold:${THREAD}`])
    await owner.activateLocal({ threadId: THREAD, fallback: EExecutionLocation.Cloud })
    expect(holds).toEqual([`hold:${THREAD}`])

    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Host,
      kind: EPlacementMoveKind.Descend,
      work: async (transaction) => transaction.commit(),
    })
    expect(holds).toEqual([`hold:${THREAD}`, `release:${THREAD}`])
  })

  it('restores the previous binding and closes the new one when adopt fails', async () => {
    const { owner, placement } = await setup()
    const first = cloudBinding()
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(first)
        await transaction.commit()
      },
    })
    placement.activate = async () => {
      throw new Error('store went away')
    }
    const second = cloudBinding()
    await expect(owner.adopt({ threadId: THREAD, binding: second })).rejects.toThrow('store went away')
    expect(owner.require()).toBe(first)
    expect(first.closed).toBe(0)
  })

  it('rolls an installed cloud runtime back when the recovery write fails, closing the new channel', async () => {
    const { owner, placement } = await setup()
    await expect(owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(cloudBinding())
        await transaction.commit()
        throw new Error('process died')
      },
    })).rejects.toThrow('process died')
    owner.detach({ threadId: THREAD })

    const recovering = cloudBinding()
    const real = placement.recover.bind(placement)
    placement.recover = async (given) => {
      await given.reconcile({ ...(placement.snapshot(THREAD) as NonNullable<ReturnType<typeof placement.snapshot>>) })
      throw new Error('durable write failed')
    }
    await expect(owner.recover({ threadId: THREAD, prepare: async () => recovering })).rejects.toThrow('durable write failed')
    expect(owner.snapshot().bound).toBe(false)
    expect(recovering.closed).toBe(1)
    placement.recover = real
  })
})
