import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, toThreadId } from '@dltech/atlas-core'

import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { EPlacementMoveKind, PlacementBusy, PlacementController } from '../placement-controller'
import { createSessionOwner, ERuntimeKind, type RuntimeBinding } from '../session-owner'

type Adapters = { name: string }

const held: StoreFixture[] = []
afterEach(async () => {
  for (const fixture of held.splice(0)) await fixture.close()
})

const THREAD = toThreadId('settling-session')

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

async function setupInCloud() {
  const fixture = openStoreFixture()
  held.push(fixture)
  const placement = new PlacementController(EExecutionLocation.Host)
  placement.bind({ threads: fixture.threads, workspace: '/work', repo: '/repo' })
  const local = binding({ kind: ERuntimeKind.Local, name: 'local', cwd: '/work' })
  const owner = createSessionOwner<Adapters>({ placement, local })
  await owner.placement.activate({ threadId: THREAD })
  const cloud = binding({ kind: ERuntimeKind.Cloud, name: 'cloud', cwd: '/sandbox' })
  await owner.move({
    threadId: THREAD,
    target: EExecutionLocation.Cloud,
    kind: EPlacementMoveKind.Lift,
    work: async (transaction) => {
      transaction.prepareRuntime(cloud)
      await transaction.commit()
    },
  })
  return { owner, local, cloud }
}

describe('session owner retired-binding close', () => {
  it('retires the cloud binding at commit but closes it only once the descend settles', async () => {
    const { owner, local, cloud } = await setupInCloud()
    const closedAt: { afterCommit?: number; boundAfterCommit?: unknown } = {}
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Host,
      kind: EPlacementMoveKind.Descend,
      work: async (transaction) => {
        transaction.prepareRuntime(local)
        await transaction.commit()
        closedAt.afterCommit = cloud.closed
        closedAt.boundAfterCommit = owner.snapshot().binding
      },
    })
    expect(closedAt.afterCommit).toBe(0)
    expect(closedAt.boundAfterCommit).toBe(local)
    expect(cloud.closed).toBe(1)
    expect(owner.snapshot().binding).toBe(local)
  })

  it('still closes the retired binding exactly once when the work throws after commit', async () => {
    const { owner, local, cloud } = await setupInCloud()
    let afterCommit = -1
    await expect(owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Host,
      kind: EPlacementMoveKind.Descend,
      work: async (transaction) => {
        transaction.prepareRuntime(local)
        await transaction.commit()
        afterCommit = cloud.closed
        throw new Error('cleanup blew up')
      },
    })).rejects.toThrow('cleanup blew up')
    expect(afterCommit).toBe(0)
    expect(cloud.closed).toBe(1)
  })

  it('does not leak the hold when a second move is refused with PlacementBusy', async () => {
    const { owner, local, cloud } = await setupInCloud()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let committedSignal: () => void = () => {}
    const committed = new Promise<void>((resolve) => {
      committedSignal = resolve
    })
    const first = owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Host,
      kind: EPlacementMoveKind.Descend,
      work: async (transaction) => {
        transaction.prepareRuntime(local)
        await transaction.commit()
        committedSignal()
        await gate
      },
    })
    await committed
    await expect(owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Host,
      kind: EPlacementMoveKind.Descend,
      work: async (transaction) => transaction.commit(),
    })).rejects.toBeInstanceOf(PlacementBusy)
    expect(cloud.closed).toBe(0)
    release()
    await first
    expect(cloud.closed).toBe(1)

    const later = binding({ kind: ERuntimeKind.Cloud, name: 'later', cwd: '/sandbox' })
    await owner.move({
      threadId: THREAD,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        transaction.prepareRuntime(later)
        await transaction.commit()
      },
    })
    owner.detach({ threadId: THREAD })
    expect(later.closed).toBe(1)
  })
})
