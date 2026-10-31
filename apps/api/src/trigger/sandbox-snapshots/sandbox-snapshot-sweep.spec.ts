import { describe, expect, it, mock } from 'bun:test'
import { FakeSandboxSnapshotStore } from '../../api/cloud/sandbox-snapshots/sandbox-snapshots.fakes'
import { sweepSandboxSnapshots } from '../../api/cloud/sandbox-snapshots/sandbox-snapshot-sweep'
import { sweepAllSandboxSnapshots } from '../../api/cloud/sandbox-snapshots/sandbox-snapshot-sweep-run'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { sealSecretValue } from '../../api/cloud/secrets/sealed-secret'

mock.module('@trigger.dev/sdk', () => ({
  schedules: { task: <T>(definition: T): T => definition },
}))

const NOW = new Date('2026-10-31T05:41:00Z')
const hoursAgo = (hours: number): Date => new Date(NOW.getTime() - hours * 3_600_000)
const snapshot = (id: string, hours: number, status: 'created' | 'failed' = 'created') => ({
  id,
  createdAt: hoursAgo(hours),
  sizeBytes: 100,
  status,
})

function seeded(): FakeSandboxSnapshotStore {
  const store = new FakeSandboxSnapshotStore()
  store.sandboxes = [
    { name: 'a', currentSnapshotId: 'cur', hasRetention: false },
    { name: 'b', currentSnapshotId: undefined, hasRetention: true },
  ]
  store.snapshots = [
    snapshot('cur', 500),
    snapshot('fresh', 2),
    snapshot('old1', 30),
    snapshot('old2', 100),
    snapshot('bad', 100, 'failed'),
  ]
  return store
}

describe('sweepSandboxSnapshots', () => {
  it('deletes only non-current snapshots older than 24h and applies missing retention', async () => {
    const store = seeded()
    const result = await sweepSandboxSnapshots({ store, now: () => NOW, dryRun: false })
    expect(result).toEqual({
      retentionApplied: 1,
      retentionFailed: 0,
      deleted: 2,
      deleteFailed: 0,
      bytesFreed: 200,
    })
    expect(store.deletedIds.sort()).toEqual(['old1', 'old2'])
    expect(store.retentionNames).toEqual(['a'])
  })

  it('reports the same counts on a dry run without mutating', async () => {
    const store = seeded()
    const result = await sweepSandboxSnapshots({ store, now: () => NOW, dryRun: true })
    expect(result).toMatchObject({ retentionApplied: 1, deleted: 2, bytesFreed: 200 })
    expect(store.deletedIds).toEqual([])
    expect(store.retentionNames).toEqual([])
  })

  it('counts failures and keeps going', async () => {
    const store = seeded()
    store.failDeleteIds.add('old1')
    store.failRetentionNames.add('a')
    const result = await sweepSandboxSnapshots({ store, now: () => NOW, dryRun: false })
    expect(result).toMatchObject({
      retentionApplied: 0,
      retentionFailed: 1,
      deleted: 1,
      deleteFailed: 1,
    })
    expect(store.deletedIds).toEqual(['old2'])
  })
})

describe('sweepAllSandboxSnapshots', () => {
  it('sweeps each credential independently when one token is bad', async () => {
    const cipher = new SecretCipherService({
      get: () => 'a'.repeat(64),
    } as unknown as ConstructorParameters<typeof SecretCipherService>[0])
    const store = seeded()
    const run = await sweepAllSandboxSnapshots({
      cipher,
      now: () => NOW,
      dryRun: true,
      log: () => {},
      listCredentials: async () => [
        { userId: 'bad', sealedToken: 'garbage', teamId: 't', vercelProjectId: 'p' },
        {
          userId: 'good',
          sealedToken: sealSecretValue({ cipher, value: 'tok' }),
          teamId: 't',
          vercelProjectId: 'p',
        },
      ],
      storeFor: () => store,
    })
    expect(run).toMatchObject({ users: 2, failedUsers: 1, totals: { deleted: 2 } })
  })
})

describe('sandboxSnapshotSweepTask', () => {
  it('registers the daily schedule', async () => {
    const { sandboxSnapshotSweepTask } = await import('./sandbox-snapshot-sweep.task')
    expect(sandboxSnapshotSweepTask).toMatchObject({
      id: 'sandbox-snapshot-sweep',
      cron: '41 5 * * *',
      retry: { maxAttempts: 3 },
    })
  })
})
