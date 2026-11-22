import { describe, expect, it } from 'bun:test'
import { isPodSandboxName, sandboxNameOf } from '../../../agent'
import {
  ORPHAN_SANDBOX_GRACE_MS,
  planOrphanSandboxes,
  planSandboxStateReconcile,
  type StoredSandboxState,
} from './orphan-sandbox-sweep'
import { NOW, daysAgo, parkedNames, sandbox, storedRow } from './orphan-sandbox-sweep.fixture'

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
    const running = sandbox('atlas-thread-busy', { status: 'running' })

    expect(
      planOrphanSandboxes({ sandboxes: [running], liveNames: new Set(), now: NOW }).stop,
    ).toEqual([])
    expect(
      planOrphanSandboxes({
        sandboxes: [running],
        liveNames: new Set(),
        retirableNames: new Set(['atlas-thread-busy']),
        now: NOW,
      }).stop.map((target) => target.name),
    ).toEqual(['atlas-thread-busy'])
  })

  it('leaves a v2 pod to the port-scoped sweep, whatever its state or listed age', () => {
    const pod = sandbox(sandboxNameOf('ses-pod'), { status: 'stopped' })

    expect(
      planOrphanSandboxes({
        sandboxes: [pod],
        liveNames: new Set(),
        retirableNames: new Set([sandboxNameOf('ses-pod')]),
        ignoreName: isPodSandboxName,
        now: NOW,
      }),
    ).toEqual({ delete: [], stop: [] })
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
