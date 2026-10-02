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

describe('session owner', () => {
  it('starts on the local binding at the placement location', async () => {
    const { owner } = await setup()
    const view = owner.snapshot()
    expect(view.location).toBe(EExecutionLocation.Host)
    expect(view.binding?.adapters.name).toBe('local')
    expect(view.cwd).toBe('/work')
    expect(view.bound).toBe(true)
  })

  it('keeps the source binding when a move fails while preparing, and a retry succeeds', async () => {
    const { owner, seen } = await setup()
    const failed = cloudBinding()
    await expect(owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(failed)
        throw new Error('sandbox never woke')
      },
    })).rejects.toThrow('sandbox never woke')
    expect(owner.snapshot().location).toBe(EExecutionLocation.Host)
    expect(owner.snapshot().binding?.adapters.name).toBe('local')
    expect(failed.closed).toBe(1)

    const retried = cloudBinding()
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(retried)
        await transaction.commit()
      },
    })
    expect(owner.snapshot().location).toBe(EExecutionLocation.Cloud)
    expect(owner.snapshot().binding).toBe(retried)
    expect(owner.snapshot().cwd).toBe('/sandbox')
    expect(retried.closed).toBe(0)
    for (const view of seen) expect(view.location === EExecutionLocation.Cloud).toBe(view.name === 'cloud')
  })

  it('refuses to commit a cloud placement that has no prepared runtime', async () => {
    const { owner } = await setup()
    await expect(owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => transaction.commit(),
    })).rejects.toThrow('prepared runtime')
    expect(owner.snapshot().location).toBe(EExecutionLocation.Host)
    expect(owner.snapshot().binding?.adapters.name).toBe('local')
  })

  it('refuses a runtime of the wrong kind for the target', async () => {
    const { owner } = await setup()
    await expect(owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(binding({ kind: ERuntimeKind.Local, name: 'other', cwd: '/x' }))
        await transaction.commit()
      },
    })).rejects.toThrow('does not fit')
    expect(owner.snapshot().location).toBe(EExecutionLocation.Host)
  })

  it('keeps the committed cloud runtime when the work fails after the commit', async () => {
    const { owner } = await setup()
    const cloud = cloudBinding()
    await expect(owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(cloud)
        await transaction.commit()
        throw new Error('socket dropped')
      },
    })).rejects.toThrow('socket dropped')
    expect(owner.snapshot().location).toBe(EExecutionLocation.Cloud)
    expect(owner.snapshot().binding).toBe(cloud)
    expect(cloud.closed).toBe(0)
  })

  it('installs the restored local runtime on descend and retires the cloud one', async () => {
    const { owner, seen } = await setup()
    const cloud = cloudBinding()
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(cloud)
        await transaction.commit()
      },
    })
    seen.length = 0

    await expect(owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Host,
      kind: EPlacementMoveKind.Descend,
      work: async (transaction) => {
        transaction.prepareRuntime(binding({ kind: ERuntimeKind.Local, name: 'broken', cwd: '/restored' }))
        throw new Error('transfer failed')
      },
    })).rejects.toThrow('transfer failed')
    expect(owner.snapshot().location).toBe(EExecutionLocation.Cloud)
    expect(owner.snapshot().binding).toBe(cloud)
    expect(cloud.closed).toBe(0)

    const restored = binding({ kind: ERuntimeKind.Local, name: 'restored', cwd: '/restored' })
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Host,
      kind: EPlacementMoveKind.Descend,
      work: async (transaction) => {
        transaction.prepareRuntime(restored)
        await transaction.commit()
      },
    })
    expect(owner.snapshot().location).toBe(EExecutionLocation.Host)
    expect(owner.snapshot().binding).toBe(restored)
    expect(owner.snapshot().cwd).toBe('/restored')
    expect(cloud.closed).toBe(1)
    for (const view of seen) expect(view.location === EExecutionLocation.Cloud).toBe(view.name === 'cloud')
  })

  it('falls back to the local runtime when a descend commits without preparing one', async () => {
    const { owner, local } = await setup()
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(cloudBinding())
        await transaction.commit()
      },
    })
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Host,
      kind: EPlacementMoveKind.Descend,
      work: async (transaction) => transaction.commit(),
    })
    expect(owner.snapshot().binding).toBe(local)
    expect(local.closed).toBe(0)
  })

  it('adopts a cloud runtime only for a thread whose placement is cloud', async () => {
    const { owner } = await setup()
    await expect(owner.adopt({ threadId: THREAD, binding: cloudBinding() })).rejects.toThrow('not in the cloud')

    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(cloudBinding())
        await transaction.commit()
      },
    })
    const reloaded = cloudBinding()
    await owner.adopt({ threadId: THREAD, binding: reloaded })
    expect(owner.snapshot().binding).toBe(reloaded)

    owner.detach({ threadId: THREAD })
    expect(reloaded.closed).toBe(1)
    expect(owner.snapshot().bound).toBe(false)
    expect(owner.snapshot().binding).toBeUndefined()
    expect(() => owner.require()).toThrow('not attached')
  })

  it('refuses to run anything while a cloud placement has no attached runtime', async () => {
    const { owner } = await setup()
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
    expect(owner.snapshot().location).toBe(EExecutionLocation.Cloud)
    expect(() => owner.require()).toThrow('not attached')
  })

  it('survives a throwing close and a throwing subscriber without losing the install', async () => {
    const { owner } = await setup()
    owner.subscribe(() => {
      throw new Error('listener blew up')
    })
    const cloud = cloudBinding()
    cloud.close = () => {
      throw new Error('close blew up')
    }
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(cloud)
        await transaction.commit()
      },
    })
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Host,
      kind: EPlacementMoveKind.Descend,
      work: async (transaction) => transaction.commit(),
    })
    expect(owner.snapshot().location).toBe(EExecutionLocation.Host)
    expect(owner.require().adapters.name).toBe('local')
  })
})
