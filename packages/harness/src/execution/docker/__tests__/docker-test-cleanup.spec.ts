import { describe, expect, it } from 'bun:test'

import { worktreeLabel } from '../sandbox'
import { removeTestSandboxes, uniqueTestPrefix, type TestCleanupEngine } from './docker-test-cleanup'

type Call = string

const fakeCleanupEngine = (args: {
  containers?: readonly string[]
  networks?: readonly string[]
  failing?: ReadonlySet<string>
}): { engine: TestCleanupEngine; calls: Call[]; listFilters: unknown[] } => {
  const calls: Call[] = []
  const listFilters: unknown[] = []
  const failing = args.failing ?? new Set<string>()
  const guard = (call: string): void => {
    calls.push(call)
    if (failing.has(call)) throw new Error(`${call} failed`)
  }

  const engine: TestCleanupEngine = {
    listContainers: async (query) => {
      listFilters.push({ kind: 'containers', ...query })
      guard('listContainers')
      return (args.containers ?? []).map((id) => ({ id, name: id, state: 'running', labels: {} }))
    },
    listNetworks: async (query) => {
      listFilters.push({ kind: 'networks', ...query })
      guard('listNetworks')
      return (args.networks ?? []).map((id) => ({ id, name: id, labels: {} }))
    },
    removeContainer: async ({ id }) => guard(`removeContainer:${id}`),
    removeNetwork: async ({ id }) => guard(`removeNetwork:${id}`),
  }
  return { engine, calls, listFilters }
}

describe('removeTestSandboxes', () => {
  it('lists every container of the prefix, stopped ones included, and its networks by the worktree label', async () => {
    const { engine, listFilters } = fakeCleanupEngine({})

    await removeTestSandboxes({ engine, prefix: 'atlas-dev-x' })

    expect(listFilters).toEqual([
      { kind: 'containers', labels: { [worktreeLabel('atlas-dev-x')]: undefined }, all: true },
      { kind: 'networks', labels: { [worktreeLabel('atlas-dev-x')]: undefined } },
    ])
  })

  it('removes the sandbox and its proxy before the network they share', async () => {
    const { engine, calls } = fakeCleanupEngine({
      containers: ['sandbox', 'proxy'],
      networks: ['net'],
    })

    await removeTestSandboxes({ engine, prefix: 'atlas-dev-x' })

    expect(calls).toEqual([
      'listContainers',
      'removeContainer:sandbox',
      'removeContainer:proxy',
      'listNetworks',
      'removeNetwork:net',
    ])
  })

  it('removes a network whose container was never created', async () => {
    const { engine, calls } = fakeCleanupEngine({ networks: ['orphan'] })

    await removeTestSandboxes({ engine, prefix: 'atlas-dev-x' })

    expect(calls).toEqual(['listContainers', 'listNetworks', 'removeNetwork:orphan'])
  })

  it('does nothing and passes when the prefix owns nothing', async () => {
    const { engine, calls } = fakeCleanupEngine({})

    await removeTestSandboxes({ engine, prefix: 'atlas-dev-x' })
    await removeTestSandboxes({ engine, prefix: 'atlas-dev-x' })

    expect(calls).toEqual(['listContainers', 'listNetworks', 'listContainers', 'listNetworks'])
  })

  it('attempts every removal, then reports each failure', async () => {
    const { engine, calls } = fakeCleanupEngine({
      containers: ['one', 'two'],
      networks: ['net-a', 'net-b'],
      failing: new Set(['removeContainer:one', 'removeNetwork:net-a']),
    })

    const outcome = await removeTestSandboxes({ engine, prefix: 'atlas-dev-x' }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(outcome).toBeInstanceOf(AggregateError)
    expect((outcome as AggregateError).errors.map((one: Error) => one.message)).toEqual([
      'removeContainer:one failed',
      'removeNetwork:net-a failed',
    ])
    expect(calls).toEqual([
      'listContainers',
      'removeContainer:one',
      'removeContainer:two',
      'listNetworks',
      'removeNetwork:net-a',
      'removeNetwork:net-b',
    ])
  })

  it('still clears networks when listing containers is rejected, and surfaces the rejection', async () => {
    const { engine, calls } = fakeCleanupEngine({
      networks: ['net'],
      failing: new Set(['listContainers']),
    })

    await expect(removeTestSandboxes({ engine, prefix: 'atlas-dev-x' })).rejects.toBeInstanceOf(
      AggregateError,
    )
    expect(calls).toEqual(['listContainers', 'listNetworks', 'removeNetwork:net'])
  })

  it('surfaces a rejected network listing', async () => {
    const { engine } = fakeCleanupEngine({ failing: new Set(['listNetworks']) })

    await expect(removeTestSandboxes({ engine, prefix: 'atlas-dev-x' })).rejects.toThrow(
      'test sandbox teardown failed for prefix atlas-dev-x',
    )
  })
})

describe('uniqueTestPrefix', () => {
  it('differs on every call and carries the suite name and process id', () => {
    const first = uniqueTestPrefix('ports')
    const second = uniqueTestPrefix('ports')

    expect(first).not.toBe(second)
    expect(first).toStartWith(`atlas-dev-ports-${process.pid}-`)
  })
})
