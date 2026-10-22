import { afterEach, describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  EHarnessPlacement,
  EToolEnvironment,
  toThreadId,
  type ThreadId,
} from '@dltech/atlas-core'

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

const cloudBinding = (name = 'cloud') =>
  binding({ kind: ERuntimeKind.Cloud, name, cwd: '/sandbox' })

async function setup() {
  const fixture = openStoreFixture()
  held.push(fixture)
  const placement = new PlacementController(EExecutionLocation.Host)
  placement.bind({ threads: fixture.threads, workspace: '/work', repo: '/repo' })
  const local = binding({ kind: ERuntimeKind.Local, name: 'local', cwd: '/work' })
  const owner = createSessionOwner<Adapters>({ placement, local })
  await owner.placement.activate({ threadId: THREAD })
  return { owner, local, placement }
}

// install's work stages the birth's runtime through the handle's prepareRuntime before committing,
// exactly as the real birth's open step does.
const bornInCloud = async (args: {
  owner: Awaited<ReturnType<typeof setup>>['owner']
  threadId?: ThreadId
}) =>
  args.owner.install({
    threadId: args.threadId ?? THREAD,
    work: async (handle) => {
      handle.prepareRuntime(cloudBinding())
      await handle.commit(CLOUD)
    },
  })

describe('session owner', () => {
  it('starts on the local binding at the placement location', async () => {
    const { owner } = await setup()
    const view = owner.snapshot()
    expect(view.location).toBe(EExecutionLocation.Host)
    expect(view.binding?.adapters.name).toBe('local')
    expect(view.cwd).toBe('/work')
    expect(view.bound).toBe(true)
  })

  it('install commits the cloud placement the birth settled on', async () => {
    const { owner, placement } = await setup()
    await bornInCloud({ owner })
    expect(owner.snapshot().location).toBe(EExecutionLocation.Cloud)
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

  it('install keeps the local placement and releases its freeze when the work fails before committing', async () => {
    const { owner, local } = await setup()
    await expect(
      owner.install({
        threadId: THREAD,
        work: async () => {
          throw new Error('sandbox never woke')
        },
      }),
    ).rejects.toThrow('sandbox never woke')
    expect(owner.snapshot().location).toBe(EExecutionLocation.Host)
    expect(owner.snapshot().binding).toBe(local)
    expect(local.frozen).toBe(1)
    expect(local.released).toBe(1)
  })

  it('install keeps the committed cloud placement and its freeze when the work fails after the commit', async () => {
    const { owner, local } = await setup()
    await expect(
      owner.install({
        threadId: THREAD,
        work: async (handle) => {
          handle.prepareRuntime(cloudBinding())
          await handle.commit(CLOUD)
          throw new Error('socket dropped')
        },
      }),
    ).rejects.toThrow('socket dropped')
    expect(owner.snapshot().location).toBe(EExecutionLocation.Cloud)
    expect(local.released).toBe(0)
  })

  it('install refuses to commit a local placement as a cloud birth', async () => {
    const { owner } = await setup()
    await expect(
      owner.install({
        threadId: THREAD,
        work: async (handle) => {
          handle.prepareRuntime(cloudBinding())
          await handle.commit({ harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host })
        },
      }),
    ).rejects.toThrow('commits a cloud placement')
    expect(owner.snapshot().location).toBe(EExecutionLocation.Host)
  })

  it('adopts a cloud runtime only for a thread whose placement is cloud', async () => {
    const { owner } = await setup()
    await expect(owner.adopt({ threadId: THREAD, binding: cloudBinding() })).rejects.toThrow(
      'not in the cloud',
    )

    await bornInCloud({ owner })
    const adopted = cloudBinding()
    await owner.adopt({ threadId: THREAD, binding: adopted })
    expect(owner.snapshot().binding).toBe(adopted)
    expect(owner.snapshot().cwd).toBe('/sandbox')
    expect(owner.snapshot().bound).toBe(true)
  })

  it('detach closes the adopted runtime and refuses to run anything until one is attached again', async () => {
    const { owner } = await setup()
    await bornInCloud({ owner })
    const adopted = cloudBinding()
    await owner.adopt({ threadId: THREAD, binding: adopted })

    owner.detach({ threadId: THREAD })
    expect(adopted.closed).toBe(1)
    expect(owner.snapshot().location).toBe(EExecutionLocation.Cloud)
    expect(owner.snapshot().bound).toBe(false)
    expect(() => owner.require()).toThrow('not attached')
  })

  it('retires the replaced cloud runtime when a thread is adopted again', async () => {
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

  it('activateLocal installs the given local binding for a host thread', async () => {
    const { owner } = await setup()
    const replacement = binding({ kind: ERuntimeKind.Local, name: 'replacement', cwd: '/other' })
    await owner.activateLocal({ threadId: THREAD, binding: replacement })
    expect(owner.snapshot().binding).toBe(replacement)
    expect(owner.snapshot().cwd).toBe('/other')
    expect(owner.snapshot().location).toBe(EExecutionLocation.Host)
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
