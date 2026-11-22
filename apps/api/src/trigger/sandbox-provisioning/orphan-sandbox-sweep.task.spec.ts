import { softDeleteArchivedSessionsIn } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, mock } from 'bun:test'
import type {
  OrphanSandbox,
  OrphanSandboxProject,
} from '../../api/cloud/sandbox-provisioning/orphan-sandbox-sweep'
import {
  AGENT37_CREDENTIALS,
  FakeSandboxProvider,
} from '../../api/cloud/sandbox-provisioning/v2-pod-sweep.fixture'
import { seedUsers } from '../../../test/session-seed'
import { runOrphanSweep, type OrphanSweepDeps } from './orphan-sweep-scopes'

mock.module('@trigger.dev/sdk', () => ({
  logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
}))

const NOW = new Date('2026-11-10T06:00:00Z')
const hoursBefore = (hours: number): Date => new Date(NOW.getTime() - hours * 60 * 60 * 1_000)

const sandboxOf = (name: string, createdAt: number): OrphanSandbox => ({
  name,
  status: 'stopped',
  createdAt,
})

const storeOf = (args: {
  label: string
  list: () => Promise<readonly OrphanSandbox[]>
}): OrphanSandboxProject => ({
  label: args.label,
  projectId: `prj-${args.label}`,
  store: {
    listSandboxes: args.list,
    deleteSandbox: async () => undefined,
    stopSandbox: async () => undefined,
  },
})

const emptyPods = {
  live: new Set<string>(),
  retirable: new Map<string, number>(),
  sessionIdsByPod: new Map<string, string[]>(),
}

const softDeleteArchived = (args: { cutoff: Date; at: Date }): Promise<number> =>
  db.transaction((tx) => softDeleteArchivedSessionsIn({ tx, cutoff: args.cutoff, at: args.at }))

const depsOf = (overrides: Partial<OrphanSweepDeps>): OrphanSweepDeps => ({
  pods: async () => emptyPods,
  v2Scopes: async () => [],
  stores: async () => [],
  liveNames: async () => new Set(),
  retirableNames: async () => new Set(),
  softDeleteArchived,
  ...overrides,
})

const expiredSession = async (): Promise<void> => {
  await seedUsers('user-a')
  await db.orm.v2.V2Session.create({
    id: 'ses-expired',
    userId: 'user-a',
    mainThreadId: 'thr_ses-expired',
    nextInboxId: 1,
    modelRef: 'anthropic/claude-haiku-4-5',
    modelEffort: 'medium',
    modelFast: false,
    sandboxProvider: 'vercel',
    credentialSource: 'byok',
    createdAt: hoursBefore(30),
    archivedAt: hoursBefore(7),
  })
}

describe('runOrphanSweep', () => {
  useTestDatabase()

  it('sweeps the other stores and soft-deletes when one store cannot list its sandboxes', async () => {
    await expiredSession()
    const lines: string[] = []

    const result = await runOrphanSweep({
      now: NOW,
      log: (line) => lines.push(line),
      deps: depsOf({
        stores: async () => [
          storeOf({
            label: 'usr-1/prj-dead',
            list: async () => {
              throw new Error('403 Not authorized')
            },
          }),
          storeOf({
            label: 'usr-1/prj-healthy',
            list: async () => [sandboxOf('atlas-thread-gone', hoursBefore(48).getTime())],
          }),
        ],
      }),
    })

    expect(result.failedScopes).toEqual(['usr-1/prj-dead'])
    expect(result.v1).toMatchObject({ scanned: 1, deleted: 1, failed: 1 })
    expect(result.softDeleted).toBe(1)
    expect(lines.some((line) => line.startsWith('usr-1/prj-dead: could not sweep'))).toBe(true)
  })

  it('soft-deletes even when the v1 scope cannot build its stores at all', async () => {
    await expiredSession()

    const result = await runOrphanSweep({
      now: NOW,
      log: () => undefined,
      fail: () => undefined,
      deps: depsOf({
        stores: async () => {
          throw new Error('the credential could not be opened')
        },
      }),
    })

    expect(result.failedScopes).toEqual(['v1 sandboxes'])
    expect(result.v1).toBeNull()
    expect(result.softDeleted).toBe(1)
  })

  it('fails the run only when every scope failed', async () => {
    const attempt = runOrphanSweep({
      now: NOW,
      log: () => undefined,
      fail: () => undefined,
      deps: depsOf({
        pods: async () => {
          throw new Error('the database is unreachable')
        },
        stores: async () => {
          throw new Error('the database is unreachable')
        },
        softDeleteArchived: async () => {
          throw new Error('the database is unreachable')
        },
      }),
    })

    await expect(attempt).rejects.toThrow('could not run any scope')
  })

  it('reports a successful run when only the v2 scope failed', async () => {
    const result = await runOrphanSweep({
      now: NOW,
      log: () => undefined,
      fail: () => undefined,
      deps: depsOf({
        pods: async () => {
          throw new Error('agent37 is down')
        },
        stores: async () => [
          storeOf({ label: 'usr-1/prj-web', list: async () => [sandboxOf('atlas-thread-a', 0)] }),
        ],
      }),
    })

    expect(result.failedScopes).toEqual(['v2 pods'])
    expect(result.v2).toBeNull()
    expect(result.v1).toMatchObject({ deleted: 1 })
  })

  it('fails the run when every listing failed and retention threw', async () => {
    const attempt = runOrphanSweep({
      now: NOW,
      log: () => undefined,
      fail: () => undefined,
      deps: depsOf({
        v2Scopes: async () => [
          {
            label: 'platform/agent37',
            credentials: AGENT37_CREDENTIALS,
            sandbox: new FakeSandboxProvider({ failList: 'agent37 is down' }),
          },
        ],
        stores: async () => [
          storeOf({
            label: 'usr-1/prj-dead',
            list: async () => {
              throw new Error('403 Not authorized')
            },
          }),
        ],
        softDeleteArchived: async () => {
          throw new Error('the database is unreachable')
        },
      }),
    })

    await expect(attempt).rejects.toThrow(
      'could not run any scope: platform/agent37, usr-1/prj-dead, archive retention',
    )
  })
})
