import { describe, expect, it } from 'bun:test'
import { FakeSandboxSnapshotStore } from './sandbox-snapshots.fakes'
import { sweepAllSandboxSnapshots, type VercelTokenSource } from './sandbox-snapshot-sweep-run'

const tokens = (byUser: Record<string, string | Error> = {}): VercelTokenSource => ({
  accessToken: async ({ userId }) => {
    const token = byUser[userId] ?? 'live-token'
    if (token instanceof Error) throw token
    return token
  },
})

const credentialRow = (
  partial: { userId?: string; vercelProjectId?: string | null } = {},
): { userId: string; teamId: string; vercelProjectId: string | null } => ({
  userId: partial.userId ?? 'usr-1',
  teamId: 'team-1',
  vercelProjectId: partial.vercelProjectId === undefined ? 'prj-current' : partial.vercelProjectId,
})

const staleStore = (): FakeSandboxSnapshotStore => {
  const store = new FakeSandboxSnapshotStore()
  store.snapshots = [
    {
      id: 'snap-old',
      createdAt: new Date('2020-01-01T00:00:00Z'),
      sizeBytes: 10,
      status: 'created',
    },
  ]
  return store
}

const runWith = async (args: {
  credentials: ReturnType<typeof credentialRow>[]
  pinned?: Record<string, string[]>
  tokenSource?: VercelTokenSource
}) => {
  const stores = new Map<string, FakeSandboxSnapshotStore>()
  const lines: string[] = []
  const run = await sweepAllSandboxSnapshots({
    tokens: args.tokenSource ?? tokens(),
    now: () => new Date('2026-11-10T00:00:00Z'),
    dryRun: false,
    log: (line) => lines.push(line),
    listCredentials: async () => args.credentials,
    listPinnedProjects: async ({ userId }) => args.pinned?.[userId] ?? [],
    storeFor: (credentials) => {
      const store = staleStore()
      stores.set(`${credentials.teamId}/${credentials.projectId}`, store)
      return store
    },
  })
  return { run, stores, lines }
}

describe('sweepAllSandboxSnapshots', () => {
  it('sweeps the credential project and every project a sandbox is still pinned to', async () => {
    const { run, stores } = await runWith({
      credentials: [credentialRow()],
      pinned: { 'usr-1': ['prj-sandboxes-old', 'prj-current'] },
    })

    expect([...stores.keys()].sort()).toEqual(['team-1/prj-current', 'team-1/prj-sandboxes-old'])
    expect(run.users).toBe(1)
    expect(run.failedUsers).toBe(0)
    expect(run.totals.deleted).toBe(2)
    expect(run.totals.bytesFreed).toBe(20)
  })

  it('keeps sweeping the credential project when no sandbox is pinned anywhere', async () => {
    const { run, stores } = await runWith({ credentials: [credentialRow()] })

    expect([...stores.keys()]).toEqual(['team-1/prj-current'])
    expect(run.totals.deleted).toBe(1)
  })

  it('counts a credential with no project and no pinned pod as a failed user instead of stopping', async () => {
    const { run, stores } = await runWith({
      credentials: [credentialRow({ vercelProjectId: null }), credentialRow({ userId: 'usr-2' })],
      pinned: { 'usr-2': ['prj-sandboxes-old'] },
    })

    expect(run.users).toBe(2)
    expect(run.failedUsers).toBe(1)
    expect([...stores.keys()].sort()).toEqual(['team-1/prj-current', 'team-1/prj-sandboxes-old'])
  })

  it('hands the store the token the source resolves, never the expired stored one', async () => {
    const seen: string[] = []
    await sweepAllSandboxSnapshots({
      tokens: tokens({ 'usr-1': 'refreshed-access-token' }),
      now: () => new Date('2026-11-10T00:00:00Z'),
      dryRun: true,
      log: () => {},
      listCredentials: async () => [credentialRow()],
      listPinnedProjects: async () => [],
      storeFor: (credentials) => {
        seen.push(credentials.token)
        return staleStore()
      },
    })

    expect(seen).toEqual(['refreshed-access-token'])
  })

  it('sweeps the remaining projects of a user after one project throws', async () => {
    const stores = new Map<string, FakeSandboxSnapshotStore>()
    const run = await sweepAllSandboxSnapshots({
      tokens: tokens(),
      now: () => new Date('2026-11-10T00:00:00Z'),
      dryRun: false,
      log: () => {},
      listCredentials: async () => [credentialRow()],
      listPinnedProjects: async () => ['prj-broken', 'prj-healthy'],
      storeFor: (credentials) => {
        const store = staleStore()
        store.failList = credentials.projectId === 'prj-broken'
        stores.set(credentials.projectId, store)
        return store
      },
    })

    expect(run.totals.deleted).toBe(2)
    expect(run.failures).toHaveLength(1)
    expect(run.failures[0]).toContain('prj-broken')
    expect(stores.get('prj-healthy')?.deletedIds).toEqual(['snap-old'])
  })

  it('names the user whose token cannot be resolved and sweeps the rest', async () => {
    const { run } = await runWith({
      credentials: [credentialRow({ userId: 'usr-1' }), credentialRow({ userId: 'usr-2' })],
      tokenSource: tokens({ 'usr-1': new Error('reconnect Vercel') }),
    })

    expect(run.users).toBe(2)
    expect(run.failedUsers).toBe(1)
    expect(run.failures[0]).toContain('user=usr-1')
    expect(run.totals.deleted).toBe(1)
  })
})
