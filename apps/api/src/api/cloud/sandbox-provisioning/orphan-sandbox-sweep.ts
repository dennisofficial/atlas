import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'

export const ORPHAN_SANDBOX_GRACE_MS = 24 * 60 * 60 * 1_000
const WORK_CONCURRENCY = 4

export type OrphanSandbox = { name: string; status: string; createdAt: number }

export type OrphanSandboxStore = {
  listSandboxes: () => Promise<readonly OrphanSandbox[]>
  deleteSandbox: (args: { name: string }) => Promise<void>
  stopSandbox: (args: { name: string }) => Promise<void>
}

export type OrphanSandboxProject = {
  label: string
  projectId: string
  store: OrphanSandboxStore
}

export type OrphanPlan = { delete: OrphanSandbox[]; stop: OrphanSandbox[] }

export type StoredSandboxState = { name: string; state: string; lastActivityAt: Date }

export type SandboxStateReconcilePlan = { park: StoredSandboxState[] }

export type SandboxStateReconciler = (args: {
  projectId: string
  sandboxes: readonly OrphanSandbox[]
}) => Promise<number>

export type OrphanSweepSummary = {
  projects: number
  scanned: number
  deleted: number
  stopped: number
  kept: number
  reconciled: number
  failed: number
  dryRun: boolean
}

/**
 * A stopped sandbox nothing can resume is pure storage: its name derives from the session that owned
 * it, so a sandbox whose name no live session resolves is unreachable by every code path and only
 * its snapshot is still billed. A *running* one is left alone unless its owner is known to be done
 * (`retirableNames`), because a running sandbox normally means someone is using it — stopping one
 * parks it, so a later pass deletes it once it has stopped.
 */
export function planOrphanSandboxes(args: {
  sandboxes: readonly OrphanSandbox[]
  liveNames: ReadonlySet<string>
  retirableNames?: ReadonlySet<string>
  now: Date
  graceMs?: number
}): OrphanPlan {
  const cutoff = args.now.getTime() - (args.graceMs ?? ORPHAN_SANDBOX_GRACE_MS)
  const retirable = args.retirableNames ?? new Set<string>()
  const doomed: OrphanSandbox[] = []
  const stoppable: OrphanSandbox[] = []
  for (const sandbox of args.sandboxes) {
    if (args.liveNames.has(sandbox.name)) continue
    if (sandbox.createdAt >= cutoff) continue
    if (sandbox.status === 'running') {
      if (retirable.has(sandbox.name)) stoppable.push(sandbox)
      continue
    }
    doomed.push(sandbox)
  }
  return { delete: doomed, stop: stoppable }
}

/**
 * Vercel stops a sandbox on its own once its idle deadline or lifetime expires, and a sandbox can be
 * gone from the project's list entirely; nothing in the create or wake path writes that back, so a
 * row keeps claiming `running` for a sandbox nobody can reach. An absent sandbox waits out the
 * grace, because a create in flight is a row with no sandbox yet.
 */
export function planSandboxStateReconcile(args: {
  rows: readonly StoredSandboxState[]
  sandboxes: readonly OrphanSandbox[]
  now: Date
  graceMs?: number
}): SandboxStateReconcilePlan {
  const cutoff = args.now.getTime() - (args.graceMs ?? ORPHAN_SANDBOX_GRACE_MS)
  const statusByName = new Map(args.sandboxes.map((sandbox) => [sandbox.name, sandbox.status]))
  const park: StoredSandboxState[] = []
  for (const row of args.rows) {
    if (row.state !== ESandboxState.Running) continue
    const status = statusByName.get(row.name)
    if (status === 'running') continue
    if (status === undefined && row.lastActivityAt.getTime() >= cutoff) continue
    park.push(row)
  }
  return { park }
}

async function runBounded<T>(args: {
  items: readonly T[]
  task: (item: T) => Promise<void>
}): Promise<void> {
  const queue = [...args.items]
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await args.task(item)
  }
  await Promise.all(Array.from({ length: WORK_CONCURRENCY }, worker))
}

export async function sweepOrphanSandboxes(args: {
  stores: readonly OrphanSandboxProject[]
  liveNames: () => Promise<ReadonlySet<string>>
  retirableNames?: () => Promise<ReadonlySet<string>>
  onRetired?: (args: { name: string }) => Promise<void>
  onStopped?: (args: { name: string }) => Promise<void>
  reconcileStates?: SandboxStateReconciler
  now: Date
  dryRun: boolean
  log: (line: string) => void
  graceMs?: number
}): Promise<OrphanSweepSummary> {
  const summary: OrphanSweepSummary = {
    projects: args.stores.length,
    scanned: 0,
    deleted: 0,
    stopped: 0,
    kept: 0,
    reconciled: 0,
    failed: 0,
    dryRun: args.dryRun,
  }
  const liveNames = await args.liveNames()
  const retirableNames = await args.retirableNames?.()
  for (const { label, projectId, store } of args.stores) {
    const sandboxes = await store.listSandboxes()
    summary.scanned += sandboxes.length
    const plan = planOrphanSandboxes({
      sandboxes,
      liveNames,
      ...(retirableNames === undefined ? {} : { retirableNames }),
      now: args.now,
      ...(args.graceMs === undefined ? {} : { graceMs: args.graceMs }),
    })
    summary.kept += sandboxes.length - plan.delete.length - plan.stop.length
    args.log(
      `${label}: ${sandboxes.length} sandboxes, ${plan.delete.length} unreachable, ${plan.stop.length} to stop${args.dryRun ? ' (dry run)' : ''}`,
    )
    if (args.dryRun) continue
    if (args.reconcileStates !== undefined) {
      summary.reconciled += await args.reconcileStates({ projectId, sandboxes })
    }
    const failed = (name: string) => (failure: unknown) => {
      summary.failed += 1
      args.log(`${label}: ${name}: ${String(failure)}`)
    }
    await runBounded({
      items: plan.stop,
      task: async (sandbox) => {
        try {
          await store.stopSandbox({ name: sandbox.name })
          summary.stopped += 1
          await args.onStopped?.({ name: sandbox.name })
        } catch (failure) {
          failed(sandbox.name)(failure)
        }
      },
    })
    await runBounded({
      items: plan.delete,
      task: async (sandbox) => {
        try {
          await store.deleteSandbox({ name: sandbox.name })
          summary.deleted += 1
          await args.onRetired?.({ name: sandbox.name })
        } catch (failure) {
          failed(sandbox.name)(failure)
        }
      },
    })
  }
  return summary
}
