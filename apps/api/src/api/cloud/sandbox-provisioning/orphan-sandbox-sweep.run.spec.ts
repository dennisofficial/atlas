import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { isPodSandboxName, sandboxNameOf } from '../../../agent'
import { seedUsers } from '../../../../test/session-seed'
import { sweepOrphanSandboxes, type OrphanSandbox } from './orphan-sandbox-sweep'
import { NOW, fakeStore, sandbox } from './orphan-sandbox-sweep.fixture'

describe('sweepOrphanSandboxes', () => {
  it('deletes per project, stops retirable ones and reports retirement', async () => {
    const web = fakeStore([sandbox('atlas-thread-dead'), sandbox('atlas-thread-live')])
    const peer = fakeStore([sandbox('atlas-thread-dead-2', { status: 'running' })])
    const retired: string[] = []
    const stopped: string[] = []

    const summary = await sweepOrphanSandboxes({
      stores: [
        { label: 'usr-1/prj-web', projectId: 'prj-web', store: web.store },
        { label: 'usr-1/prj-sandboxes', projectId: 'prj-sandboxes', store: peer.store },
      ],
      liveNames: async () => new Set(['atlas-thread-live']),
      retirableNames: async () => new Set(['atlas-thread-dead-2']),
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
    expect(peer.stopped).toEqual(['atlas-thread-dead-2'])
    expect(stopped).toEqual(['atlas-thread-dead-2'])
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

  it('carries on to the other stores when one store cannot list its sandboxes', async () => {
    const broken = {
      listSandboxes: async (): Promise<readonly OrphanSandbox[]> => {
        throw new Error('403 Not authorized')
      },
      deleteSandbox: async () => undefined,
      stopSandbox: async () => undefined,
    }
    const healthy = fakeStore([sandbox('atlas-thread-dead')])
    const lines: string[] = []

    const summary = await sweepOrphanSandboxes({
      stores: [
        { label: 'usr-1/prj-dead', projectId: 'prj-dead', store: broken },
        { label: 'usr-1/prj-healthy', projectId: 'prj-healthy', store: healthy.store },
      ],
      liveNames: async () => new Set(),
      now: NOW,
      dryRun: false,
      log: (line) => lines.push(line),
    })

    expect(summary).toMatchObject({
      scanned: 1,
      deleted: 1,
      failed: 1,
      failedScopes: ['usr-1/prj-dead'],
    })
    expect(healthy.deleted).toEqual(['atlas-thread-dead'])
    expect(lines.some((line) => line.startsWith('usr-1/prj-dead: could not sweep'))).toBe(true)
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

describe('sweepOrphanSandboxes and v2 pods', () => {
  useTestDatabase()

  it('leaves a v2 pod to the port-scoped sweep and keeps its terminals open', async () => {
    await seedUsers('user-a')
    await db.orm.v2.V2Session.create({
      id: 'ses-pod',
      userId: 'user-a',
      mainThreadId: 'thr_ses-pod',
      nextInboxId: 1,
      modelRef: 'anthropic/claude-haiku-4-5',
      modelEffort: 'medium',
      modelFast: false,
      createdAt: NOW,
    })
    await db.orm.v2.V2Terminal.create({
      sessionId: 'ses-pod',
      terminalId: 't1',
      ordinal: 1,
      name: 'Terminal 1',
      state: 'open',
      createdAt: NOW,
    })
    const peer = fakeStore([sandbox(sandboxNameOf('ses-pod'), { status: 'stopped' })])

    const summary = await sweepOrphanSandboxes({
      stores: [{ label: 'usr-1/prj-sandboxes', projectId: 'prj-sandboxes', store: peer.store }],
      liveNames: async () => new Set(),
      retirableNames: async () => new Set([sandboxNameOf('ses-pod')]),
      ignoreName: isPodSandboxName,
      now: NOW,
      dryRun: false,
      log: () => undefined,
    })

    expect(peer.deleted).toEqual([])
    expect(peer.stopped).toEqual([])
    expect(summary).toMatchObject({ deleted: 0, stopped: 0, kept: 1 })
    const rows = await db.orm.v2.V2Terminal.where({ sessionId: 'ses-pod' })
      .select('state', 'endedReason')
      .all()
    expect(rows).toEqual([{ state: 'open', endedReason: null }])
  })
})
