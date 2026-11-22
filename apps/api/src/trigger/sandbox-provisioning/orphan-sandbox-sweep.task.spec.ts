import { describe, expect, it, mock } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type {
  OrphanSandbox,
  OrphanSandboxProject,
} from '../../api/cloud/sandbox-provisioning/orphan-sandbox-sweep'
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

const depsOf = (overrides: Partial<OrphanSweepDeps>): OrphanSweepDeps => ({
  stores: async () => [],
  liveNames: async () => new Set(),
  retirableNames: async () => new Set(),
  ...overrides,
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
