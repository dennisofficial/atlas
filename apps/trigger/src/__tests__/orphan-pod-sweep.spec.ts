import { describe, expect, it, mock } from 'bun:test'
import { softDeleteArchivedSessionsIn } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import {
  AGENT37_CREDENTIALS,
  FakeSandboxProvider,
  listing,
  scope,
} from '@dltech/atlas-pods/pods/v2-pod-sweep.fixture'
import type { OrphanPodSweepDeps } from '../sandbox-provisioning/orphan-pod-sweep'
import { triggerSdkFake } from './trigger-sdk.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)

const { runOrphanPodSweep } = await import('../sandbox-provisioning/orphan-pod-sweep')

const NOW = new Date('2026-11-10T06:00:00Z')
const hoursBefore = (hours: number): Date => new Date(NOW.getTime() - hours * 60 * 60 * 1_000)

const emptyPods = {
  live: new Set<string>(),
  retirable: new Map<string, number>(),
  sessionIdsByPod: new Map<string, string[]>(),
}

const softDeleteArchived = (args: { cutoff: Date; at: Date }): Promise<number> =>
  db.transaction((tx) => softDeleteArchivedSessionsIn({ tx, cutoff: args.cutoff, at: args.at }))

const depsOf = (overrides: Partial<OrphanPodSweepDeps>): OrphanPodSweepDeps => ({
  pods: async () => emptyPods,
  v2Scopes: async () => [],
  softDeleteArchived,
  markPreviewDeleting: async () => undefined,
  ...overrides,
})

const archivedSession = async (args: { id: string; archivedAt: Date }): Promise<void> => {
  await seedUser({ db, id: 'user-a' })
  await db.orm.v2.V2Session.create({
    id: args.id,
    userId: 'user-a',
    mainThreadId: `thr_${args.id}`,
    nextInboxId: 1,
    modelRef: 'anthropic/claude-haiku-4-5',
    modelEffort: 'medium',
    modelFast: false,
    sandboxProvider: 'agent37',
    credentialSource: 'platform',
    createdAt: hoursBefore(30),
    archivedAt: args.archivedAt,
  })
}

const expiredSession = async (): Promise<void> => {
  await seedUser({ db, id: 'user-a' })
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

describe('runOrphanPodSweep', () => {
  useTestDatabase()

  it('soft-deletes past the grace when the v2 scope cannot build its scopes', async () => {
    await expiredSession()

    const result = await runOrphanPodSweep({
      now: NOW,
      log: () => undefined,
      fail: () => undefined,
      deps: depsOf({
        v2Scopes: async () => {
          throw new Error('the platform credential could not be read')
        },
      }),
    })

    expect(result.failedScopes).toEqual(['v2 pods'])
    expect(result.v2).toBeNull()
    expect(result.softDeleted).toBe(1)
  })

  it('reports a successful run when the v2 scope failed but retention succeeded', async () => {
    const result = await runOrphanPodSweep({
      now: NOW,
      log: () => undefined,
      fail: () => undefined,
      deps: depsOf({
        pods: async () => {
          throw new Error('agent37 is down')
        },
      }),
    })

    expect(result.failedScopes).toEqual(['v2 pods'])
    expect(result.v2).toBeNull()
    expect(result.softDeleted).toBe(0)
  })

  it('fails the run only when every scope failed', async () => {
    const attempt = runOrphanPodSweep({
      now: NOW,
      log: () => undefined,
      fail: () => undefined,
      deps: depsOf({
        pods: async () => {
          throw new Error('the database is unreachable')
        },
        softDeleteArchived: async () => {
          throw new Error('the database is unreachable')
        },
      }),
    })

    await expect(attempt).rejects.toThrow(
      'orphan-pod-sweep could not run any scope: v2 pods, archive retention',
    )
  })

  it('marks the preview tunnel of a retired pod for deletion', async () => {
    await archivedSession({ id: 'pod-retired', archivedAt: hoursBefore(7) })
    const marked: string[] = []

    const result = await runOrphanPodSweep({
      now: NOW,
      log: () => undefined,
      fail: () => undefined,
      deps: depsOf({
        pods: async () => ({
          live: new Set<string>(),
          retirable: new Map([['pod-retired', hoursBefore(7).getTime()]]),
          sessionIdsByPod: new Map([['pod-retired', ['pod-retired']]]),
        }),
        v2Scopes: async () => [
          scope(
            new FakeSandboxProvider({ listings: [listing({ sandboxSessionId: 'pod-retired' })] }),
          ),
        ],
        markPreviewDeleting: async ({ podSessionId }) => {
          marked.push(podSessionId)
        },
      }),
    })

    expect(result.v2?.deleted).toBe(1)
    expect(marked).toEqual(['pod-retired'])
  })

  it('fails the run when every listing failed and retention threw', async () => {
    const attempt = runOrphanPodSweep({
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
        softDeleteArchived: async () => {
          throw new Error('the database is unreachable')
        },
      }),
    })

    await expect(attempt).rejects.toThrow(
      'could not run any scope: platform/agent37, archive retention',
    )
  })
})
