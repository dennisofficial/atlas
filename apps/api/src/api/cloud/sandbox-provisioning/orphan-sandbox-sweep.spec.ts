import { describe, expect, it } from 'bun:test'
import {
  ORPHAN_SANDBOX_GRACE_MS,
  planOrphanSandboxes,
  planSandboxStateReconcile,
  sweepOrphanSandboxes,
  type OrphanSandbox,
  type StoredSandboxState,
} from './orphan-sandbox-sweep'

const NOW = new Date('2026-11-10T06:00:00Z')
const daysAgo = (days: number): number => NOW.getTime() - days * 24 * 60 * 60 * 1_000
const sandbox = (name: string, overrides: Partial<OrphanSandbox> = {}): OrphanSandbox => ({
  name,
  status: 'stopped',
  createdAt: daysAgo(5),
  ...overrides,
})

const fakeStore = (sandboxes: OrphanSandbox[]) => {
  const deleted: string[] = []
  const stopped: string[] = []
  return {
    deleted,
    stopped,
    store: {
      listSandboxes: async () => sandboxes,
      deleteSandbox: async (args: { name: string }) => {
        deleted.push(args.name)
      },
      stopSandbox: async (args: { name: string }) => {
        stopped.push(args.name)
      },
    },
  }
}

describe('planOrphanSandboxes', () => {
  it('deletes stopped sandboxes no live session can resolve, whatever their age', () => {
    const plan = planOrphanSandboxes({
      sandboxes: [sandbox('atlas-thread-dead'), sandbox('atlas-thread-live')],
      liveNames: new Set(['atlas-thread-live']),
      now: NOW,
    })

    expect(plan.delete.map((target) => target.name)).toEqual(['atlas-thread-dead'])
    expect(plan.stop).toEqual([])
  })

  it('leaves a running sandbox alone unless its owner is done', () => {
    const running = sandbox('atlas-v2-pod', { status: 'running' })

    expect(
      planOrphanSandboxes({ sandboxes: [running], liveNames: new Set(), now: NOW }).stop,
    ).toEqual([])
    expect(
      planOrphanSandboxes({
        sandboxes: [running],
        liveNames: new Set(),
        retirableNames: new Set(['atlas-v2-pod']),
        now: NOW,
      }).stop.map((target) => target.name),
    ).toEqual(['atlas-v2-pod'])
  })

  it('waits out the grace before touching a fresh one', () => {
    const fresh = sandbox('atlas-thread-gone', { createdAt: NOW.getTime() - 60_000 })

    expect(
      planOrphanSandboxes({ sandboxes: [fresh], liveNames: new Set(), now: NOW }).delete,
    ).toEqual([])
    expect(
      planOrphanSandboxes({
        sandboxes: [fresh],
        liveNames: new Set(),
        now: new Date(NOW.getTime() + ORPHAN_SANDBOX_GRACE_MS),
      }).delete,
    ).toHaveLength(1)
  })
})

const storedRow = (
  name: string,
  overrides: Partial<StoredSandboxState> = {},
): StoredSandboxState => ({
  name,
  state: 'running',
  lastActivityAt: new Date(daysAgo(1)),
  ...overrides,
})

const parkedNames = (plan: { park: StoredSandboxState[] }): string[] =>
  plan.park.map((row) => row.name)

describe('planSandboxStateReconcile', () => {
  it('parks a running row whose sandbox Vercel reports stopped', () => {
    const plan = planSandboxStateReconcile({
      rows: [storedRow('atlas-thread-stopped', { lastActivityAt: NOW })],
      sandboxes: [sandbox('atlas-thread-stopped', { status: 'stopped' })],
      now: NOW,
    })

    expect(parkedNames(plan)).toEqual(['atlas-thread-stopped'])
  })

  it('parks a running row with no sandbox left only once it is past the grace', () => {
    const fresh = storedRow('atlas-thread-fresh', { lastActivityAt: NOW })
    const stale = storedRow('atlas-thread-stale', {
      lastActivityAt: new Date(NOW.getTime() - ORPHAN_SANDBOX_GRACE_MS - 1),
    })

    expect(
      parkedNames(planSandboxStateReconcile({ rows: [fresh], sandboxes: [], now: NOW })),
    ).toEqual([])
    expect(
      parkedNames(planSandboxStateReconcile({ rows: [stale], sandboxes: [], now: NOW })),
    ).toEqual(['atlas-thread-stale'])
  })

  it('leaves a running row whose sandbox Vercel reports running', () => {
    const plan = planSandboxStateReconcile({
      rows: [storedRow('atlas-thread-live')],
      sandboxes: [sandbox('atlas-thread-live', { status: 'running' })],
      now: NOW,
    })

    expect(plan).toEqual({ park: [] })
  })

  it('never rewrites a parked row, whatever Vercel reports', () => {
    const parked = (name: string): StoredSandboxState =>
      storedRow(name, { state: 'parked', lastActivityAt: new Date(daysAgo(9)) })
    const rows = [parked('atlas-thread-a'), parked('atlas-thread-b'), parked('atlas-thread-c')]

    const plan = planSandboxStateReconcile({
      rows,
      sandboxes: [
        sandbox('atlas-thread-a', { status: 'running' }),
        sandbox('atlas-thread-b', { status: 'stopped' }),
      ],
      now: NOW,
    })

    expect(plan).toEqual({ park: [] })
  })
})

describe('sweepOrphanSandboxes', () => {
  it('deletes per project, stops retirable ones and reports retirement', async () => {
    const web = fakeStore([sandbox('atlas-thread-dead'), sandbox('atlas-thread-live')])
    const peer = fakeStore([sandbox('atlas-v2-dead', { status: 'running' })])
    const retired: string[] = []
    const stopped: string[] = []

    const summary = await sweepOrphanSandboxes({
      stores: [
        { label: 'usr-1/prj-web', projectId: 'prj-web', store: web.store },
        { label: 'usr-1/prj-sandboxes', projectId: 'prj-sandboxes', store: peer.store },
      ],
      liveNames: async () => new Set(['atlas-thread-live']),
      retirableNames: async () => new Set(['atlas-v2-dead']),
      onStopped: async ({ name }) => {
        stopped.push(name)
      },
      onRetired: async ({ name }) => {
        retired.push(name)
      },
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(summary).toMatchObject({
      projects: 2,
      scanned: 3,
      deleted: 1,
      stopped: 1,
      kept: 1,
      failed: 0,
    })
    expect(web.deleted).toEqual(['atlas-thread-dead'])
    expect(peer.stopped).toEqual(['atlas-v2-dead'])
    expect(stopped).toEqual(['atlas-v2-dead'])
    expect(retired).toEqual(['atlas-thread-dead'])
  })

  it('reports what it would do on a dry run without touching anything', async () => {
    const web = fakeStore([sandbox('atlas-thread-dead')])

    const summary = await sweepOrphanSandboxes({
      stores: [{ label: 'usr-1/prj-web', projectId: 'prj-web', store: web.store }],
      liveNames: async () => new Set(),
      now: NOW,
      dryRun: true,
      log: () => undefined,
    })

    expect(summary).toMatchObject({ scanned: 1, deleted: 0, stopped: 0, dryRun: true })
    expect(web.deleted).toEqual([])
  })

  it('keeps going when one deletion fails', async () => {
    const store = {
      listSandboxes: async () => [sandbox('atlas-thread-a'), sandbox('atlas-thread-b')],
      deleteSandbox: async (args: { name: string }) => {
        if (args.name === 'atlas-thread-a') throw new Error('provider said no')
      },
      stopSandbox: async () => undefined,
    }

    const summary = await sweepOrphanSandboxes({
      stores: [{ label: 'usr-1/prj-web', projectId: 'prj-web', store }],
      liveNames: async () => new Set(),
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(summary).toMatchObject({ deleted: 1, failed: 1 })
  })

  it('reconciles stored states per project and sums the corrected rows', async () => {
    const web = fakeStore([sandbox('atlas-thread-gone', { status: 'stopped' })])
    const seen: Array<{ projectId: string; names: string[] }> = []

    const summary = await sweepOrphanSandboxes({
      stores: [{ label: 'usr-1/prj-web', projectId: 'prj-web', store: web.store }],
      liveNames: async () => new Set(['atlas-thread-gone']),
      reconcileStates: async (args) => {
        seen.push({ projectId: args.projectId, names: args.sandboxes.map((one) => one.name) })
        return 2
      },
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(seen).toEqual([{ projectId: 'prj-web', names: ['atlas-thread-gone'] }])
    expect(summary.reconciled).toBe(2)
  })
})
