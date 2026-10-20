import { afterEach, describe, expect, it } from 'bun:test'

import { EHarnessPlacement, toThreadId, type ThreadId } from '@dltech/atlas-core'

import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { PlacementController } from '../placement-controller'
import { createSessionOwner, ERuntimeKind, type RuntimeBinding } from '../session-owner'

type Adapters = { name: string }
type Probe = RuntimeBinding<Adapters> & { closed: number; frozen: number; released: number }

const held: StoreFixture[] = []
afterEach(async () => {
  for (const fixture of held.splice(0)) await fixture.close()
})

const THREAD = toThreadId('owned-session')
const CLOUD = { harness: EHarnessPlacement.Cloud, driveName: 'drive-1' } as const

const binding = (args: { kind: ERuntimeKind; name: string; cwd: string }): Probe => {
  const made: Probe = {
    kind: args.kind,
    cwd: args.cwd,
    adapters: { name: args.name },
    closed: 0,
    frozen: 0,
    released: 0,
    close: () => {
      made.closed += 1
    },
    freeze: async () => {
      made.frozen += 1
      return () => {
        made.released += 1
      }
    },
  }
  return made
}

const cloudBinding = (name = 'cloud') => binding({ kind: ERuntimeKind.Cloud, name, cwd: '/sandbox' })

async function setup() {
  const fixture = openStoreFixture()
  held.push(fixture)
  const placement = new PlacementController()
  placement.bind({ threads: fixture.threads, workspace: '/work', repo: '/repo' })
  const base = { frozen: 0, released: 0 }
  const owner = createSessionOwner<Adapters>({
    placement,
    freeze: async () => {
      base.frozen += 1
      return () => {
        base.released += 1
      }
    },
  })
  await owner.placement.activate({ threadId: THREAD })
  return { owner, base, placement }
}

const bornInCloud = async (args: { owner: Awaited<ReturnType<typeof setup>>['owner']; threadId?: ThreadId }) =>
  args.owner.install({
    threadId: args.threadId ?? THREAD,
    work: async (handle) => {
      handle.prepareRuntime(cloudBinding())
      await handle.commit(CLOUD)
    },
  })

describe('session owner', () => {
  it('starts unplaced and unbound, holding no runtime', async () => {
    const { owner } = await setup()
    const view = owner.snapshot()
    expect(view.placed).toBe(false)
    expect(view.binding).toBeUndefined()
    expect(view.bound).toBe(false)
    expect(() => owner.require()).toThrow('not attached')
  })

  it('install commits the cloud placement the birth settled on and binds its runtime', async () => {
    const { owner, placement } = await setup()
    await bornInCloud({ owner })
    expect(owner.snapshot().placed).toBe(true)
    expect(owner.snapshot().bound).toBe(true)
    expect(owner.snapshot().binding?.adapters.name).toBe('cloud')
    expect(placement.snapshot(THREAD)?.placement).toEqual(CLOUD)
  })

  it('install returns what its work returned', async () => {
    const { owner } = await setup()
    const out = await owner.install({
      threadId: THREAD,
      work: async (handle) => {
        handle.prepareRuntime(cloudBinding())
        await handle.commit(CLOUD)
        return 'provisioned'
      },
    })
    expect(out).toBe('provisioned')
  })

  it('install stays unplaced and releases its freeze when the work fails before committing', async () => {
    const { owner, base } = await setup()
    await expect(owner.install({
      threadId: THREAD,
      work: async () => {
        throw new Error('sandbox never woke')
      },
    })).rejects.toThrow('sandbox never woke')
    expect(owner.snapshot().placed).toBe(false)
    expect(owner.snapshot().binding).toBeUndefined()
    expect(base.frozen).toBe(1)
    expect(base.released).toBe(1)
  })

  it('install keeps the committed placement and its freeze when the work fails after the commit', async () => {
    const { owner, base } = await setup()
    await expect(owner.install({
      threadId: THREAD,
      work: async (handle) => {
        handle.prepareRuntime(cloudBinding())
        await handle.commit(CLOUD)
        throw new Error('socket dropped')
      },
    })).rejects.toThrow('socket dropped')
    expect(owner.snapshot().placed).toBe(true)
    expect(base.released).toBe(0)
  })

  it('refuses to adopt a runtime for a thread that was never placed', async () => {
    const { owner } = await setup()
    await expect(owner.adopt({ threadId: toThreadId('never-born'), binding: cloudBinding() })).rejects.toThrow(
      'not placed',
    )
  })

  it('adopts a runtime for a placed thread', async () => {
    const { owner } = await setup()
    await bornInCloud({ owner })
    const adopted = cloudBinding()
    await owner.adopt({ threadId: THREAD, binding: adopted })
    expect(owner.snapshot().binding).toBe(adopted)
    expect(owner.snapshot().bound).toBe(true)
  })

  it('detach closes the adopted runtime and refuses to run anything until one is attached again', async () => {
    const { owner } = await setup()
    await bornInCloud({ owner })
    const adopted = cloudBinding()
    await owner.adopt({ threadId: THREAD, binding: adopted })

    owner.detach({ threadId: THREAD })
    expect(adopted.closed).toBe(1)
    expect(owner.snapshot().placed).toBe(true)
    expect(owner.snapshot().bound).toBe(false)
    expect(() => owner.require()).toThrow('not attached')
  })

  it('retires the replaced runtime when a thread is adopted again', async () => {
    const { owner } = await setup()
    await bornInCloud({ owner })
    const first = cloudBinding('first')
    const second = cloudBinding('second')
    await owner.adopt({ threadId: THREAD, binding: first })
    await owner.adopt({ threadId: THREAD, binding: second })
    expect(owner.snapshot().binding).toBe(second)
    expect(first.closed).toBe(1)
    expect(second.closed).toBe(0)
  })

  it('survives a throwing close and a throwing subscriber without losing the adoption', async () => {
    const { owner } = await setup()
    owner.subscribe(() => {
      throw new Error('listener blew up')
    })
    await bornInCloud({ owner })
    const first = cloudBinding('first')
    first.close = () => {
      throw new Error('close blew up')
    }
    await owner.adopt({ threadId: THREAD, binding: first })
    const second = cloudBinding('second')
    await owner.adopt({ threadId: THREAD, binding: second })
    owner.detach({ threadId: THREAD })
    expect(owner.snapshot().bound).toBe(false)
    expect(second.closed).toBe(1)
  })
})
