import { describe, expect, it } from 'bun:test'
import {
  ORPHAN_SANDBOX_GRACE_MS,
  orphanSandboxesToDelete,
  sweepOrphanSandboxes,
  type OrphanSandbox,
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
  return {
    deleted,
    store: {
      listSandboxes: async () => sandboxes,
      deleteSandbox: async (args: { name: string }) => {
        deleted.push(args.name)
      },
    },
  }
}

describe('orphanSandboxesToDelete', () => {
  it('takes stopped sandboxes no live session can resolve, whatever their age', () => {
    const targets = orphanSandboxesToDelete({
      sandboxes: [sandbox('atlas-thread-dead'), sandbox('atlas-thread-live')],
      liveNames: new Set(['atlas-thread-live']),
      now: NOW,
    })

    expect(targets.map((target) => target.name)).toEqual(['atlas-thread-dead'])
  })

  it('never touches a running sandbox', () => {
    const targets = orphanSandboxesToDelete({
      sandboxes: [sandbox('atlas-thread-live', { status: 'running' })],
      liveNames: new Set(),
      now: NOW,
    })

    expect(targets).toEqual([])
  })

  it('waits out the grace before deleting a fresh one', () => {
    const fresh = sandbox('atlas-thread-gone', { createdAt: NOW.getTime() - 60_000 })

    expect(orphanSandboxesToDelete({ sandboxes: [fresh], liveNames: new Set(), now: NOW })).toEqual(
      [],
    )
    expect(
      orphanSandboxesToDelete({
        sandboxes: [fresh],
        liveNames: new Set(),
        now: new Date(NOW.getTime() + ORPHAN_SANDBOX_GRACE_MS),
      }),
    ).toHaveLength(1)
  })
})

describe('sweepOrphanSandboxes', () => {
  it('deletes per project and keeps the rest', async () => {
    const web = fakeStore([sandbox('atlas-thread-dead'), sandbox('atlas-thread-live')])
    const sandboxes = fakeStore([sandbox('atlas-v2-peer')])

    const summary = await sweepOrphanSandboxes({
      stores: [
        { label: 'usr-1/prj-web', store: web.store },
        { label: 'usr-1/prj-sandboxes', store: sandboxes.store },
      ],
      liveNames: async () => new Set(['atlas-thread-live', 'atlas-v2-peer']),
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(summary).toMatchObject({ projects: 2, scanned: 3, deleted: 1, kept: 2, failed: 0 })
    expect(web.deleted).toEqual(['atlas-thread-dead'])
    expect(sandboxes.deleted).toEqual([])
  })

  it('reports what it would delete on a dry run without deleting', async () => {
    const web = fakeStore([sandbox('atlas-thread-dead')])

    const summary = await sweepOrphanSandboxes({
      stores: [{ label: 'usr-1/prj-web', store: web.store }],
      liveNames: async () => new Set(),
      now: NOW,
      dryRun: true,
      log: () => undefined,
    })

    expect(summary).toMatchObject({ scanned: 1, deleted: 0, dryRun: true })
    expect(web.deleted).toEqual([])
  })

  it('keeps going when one deletion fails', async () => {
    const store = {
      listSandboxes: async () => [sandbox('atlas-thread-a'), sandbox('atlas-thread-b')],
      deleteSandbox: async (args: { name: string }) => {
        if (args.name === 'atlas-thread-a') throw new Error('provider said no')
      },
    }

    const summary = await sweepOrphanSandboxes({
      stores: [{ label: 'usr-1/prj-web', store }],
      liveNames: async () => new Set(),
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(summary).toMatchObject({ deleted: 1, failed: 1 })
  })
})
