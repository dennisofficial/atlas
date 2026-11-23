import type { VercelCredentials } from '@dltech/atlas-wire'
import { describe, expect, it, mock } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { readPodsEnv } from '@dltech/atlas-pods'
import type {
  OrphanSandbox,
  OrphanSandboxProject,
  OrphanSandboxStore,
} from '../../api/cloud/sandbox-provisioning/orphan-sandbox-sweep'
import { runOrphanSweep, type OrphanSweepDeps } from './orphan-sweep-scopes'
import { storesOf } from './orphan-sandbox-sweep.task'
import { triggerSdkStub } from '../../../test/trigger-sdk.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkStub)

const REQUIRED_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://x',
  DATABASE_DIRECT_URL: 'postgres://direct',
  REDIS_URL: 'redis://x',
  DAEMON_SECRET: 'secret',
  SECRETS_ENCRYPTION_KEY: 'k'.repeat(64),
  ATLAS_API_ORIGIN: 'https://api.byatlas.io',
  CLOUDFLARE_API_TOKEN: 'cf-token',
  CLOUDFLARE_ACCOUNT_ID: 'cf-account',
  CLOUDFLARE_ZONE_ID: 'cf-zone',
}

const credentialsOf = (store: OrphanSandboxStore): VercelCredentials =>
  (store as unknown as { credentials: VercelCredentials }).credentials

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

const depsOf = (overrides: Partial<OrphanSweepDeps>): OrphanSweepDeps => ({
  stores: async () => [],
  liveNames: async () => new Set(),
  retirableNames: async () => new Set(),
  ...overrides,
})

describe('storesOf', () => {
  it('sweeps the platform project named by PLATFORM_VERCEL_* and no user credential store', async () => {
    const lines: string[] = []
    const env = readPodsEnv({
      ...REQUIRED_ENV,
      PLATFORM_VERCEL_TOKEN: 'platform-token',
      PLATFORM_VERCEL_TEAM_ID: 'team-platform',
      PLATFORM_VERCEL_PROJECT_ID: 'prj-atlas-sandboxes',
    })

    const stores = await storesOf({ env, log: (line) => lines.push(line) })

    expect(stores.map((store) => [store.label, store.projectId])).toEqual([
      ['platform/prj-atlas-sandboxes', 'prj-atlas-sandboxes'],
    ])
    const store = stores[0]
    expect(store === undefined ? undefined : credentialsOf(store.store)).toEqual({
      token: 'platform-token',
      teamId: 'team-platform',
      projectId: 'prj-atlas-sandboxes',
    })
    expect(lines).toEqual([])
  })

  it('sweeps nothing when only the retired VERCEL_* vars are set', async () => {
    const lines: string[] = []
    const env = readPodsEnv({
      ...REQUIRED_ENV,
      VERCEL_TOKEN: 'legacy-token',
      VERCEL_TEAM_ID: 'legacy-team',
      VERCEL_PROJECT_ID: 'legacy-project',
    })

    const stores = await storesOf({ env, log: (line) => lines.push(line) })

    expect(stores).toEqual([])
    expect(lines).toEqual(['platform: PLATFORM_VERCEL_TOKEN/TEAM_ID/PROJECT_ID are not configured'])
  })
})

describe('runOrphanSweep', () => {
  useTestDatabase()

  it('sweeps the other stores when one store cannot list its sandboxes', async () => {
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
    expect(lines.some((line) => line.startsWith('usr-1/prj-dead: could not sweep'))).toBe(true)
  })

  it('fails the run when the v1 scope cannot build its stores at all', async () => {
    const attempt = runOrphanSweep({
      now: NOW,
      log: () => undefined,
      fail: () => undefined,
      deps: depsOf({
        stores: async () => {
          throw new Error('the credential could not be opened')
        },
      }),
    })

    await expect(attempt).rejects.toThrow(
      'orphan-sandbox-sweep could not run any scope: v1 sandboxes',
    )
  })

  it('fails the run when every listing failed', async () => {
    const attempt = runOrphanSweep({
      now: NOW,
      log: () => undefined,
      fail: () => undefined,
      deps: depsOf({
        stores: async () => [
          storeOf({
            label: 'usr-1/prj-dead',
            list: async () => {
              throw new Error('403 Not authorized')
            },
          }),
        ],
      }),
    })

    await expect(attempt).rejects.toThrow('could not run any scope: usr-1/prj-dead')
  })
})
