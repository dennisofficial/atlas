import { describe, expect, it } from 'bun:test'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { FakeSandboxSnapshotStore } from './sandbox-snapshots.fakes'
import { sweepAllSandboxSnapshots } from './sandbox-snapshot-sweep-run'

const cipher = {
  decrypt: () => JSON.stringify('sealed-token'),
} as unknown as SecretCipherService

const credentialRow = (
  partial: { userId?: string; vercelProjectId?: string | null } = {},
): { userId: string; sealedToken: string; teamId: string; vercelProjectId: string | null } => ({
  userId: partial.userId ?? 'usr-1',
  sealedToken: 'sealed',
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
}) => {
  const stores = new Map<string, FakeSandboxSnapshotStore>()
  const lines: string[] = []
  const run = await sweepAllSandboxSnapshots({
    cipher,
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
})
