import { db } from '@dltech/atlas-db'
import { ESandboxState } from '../../api/platform/sandboxes/sandboxes.types'
import {
  planSandboxStateReconcile,
  sweepOrphanSandboxes,
  type OrphanSandbox,
  type OrphanSandboxProject,
  type OrphanSweepSummary,
  type SandboxStateReconciler,
} from '../../api/cloud/sandbox-provisioning/orphan-sandbox-sweep'
import { isPodSandboxName } from '@dltech/atlas-pods/sandbox/vercel-names'
import { triggerLog } from '../trigger-logger'

async function reconcileStates(args: {
  projectId: string
  sandboxes: readonly OrphanSandbox[]
  now: Date
}): Promise<number> {
  const rows = await db.orm.public.CloudSandbox.where({ vercelProjectId: args.projectId })
    .select('name', 'state', 'lastActivityAt')
    .all()
  const plan = planSandboxStateReconcile({
    rows,
    sandboxes: args.sandboxes,
    now: args.now,
  })
  const at = new Date()
  for (const row of plan.park) {
    await db.orm.public.CloudSandbox.where({ name: row.name }).update({
      state: ESandboxState.Parked,
      runtimeCheckpoint: null,
      runtimeCheckpointRevision: null,
      updatedAt: at,
    })
  }
  return plan.park.length
}

export type OrphanSweepDeps = {
  stores: () => Promise<readonly OrphanSandboxProject[]>
  liveNames: () => Promise<ReadonlySet<string>>
  retirableNames: () => Promise<ReadonlySet<string>>
}

export type OrphanSweepRun = {
  v1: OrphanSweepSummary | null
  failedScopes: string[]
}

export async function runOrphanSweep(args: {
  now: Date
  deps: OrphanSweepDeps
  log?: (line: string) => void
  fail?: (line: string) => void
}): Promise<OrphanSweepRun> {
  const log = args.log ?? ((line: string) => triggerLog.log(line))
  const fail = args.fail ?? ((line: string) => triggerLog.error(line))
  const failedScopes: string[] = []
  let succeeded = 0
  const inScope = async <T>(scope: {
    label: string
    run: () => Promise<T>
  }): Promise<T | undefined> => {
    try {
      return await scope.run()
    } catch (failure) {
      failedScopes.push(scope.label)
      fail(`${scope.label}: could not run: ${String(failure)}`)
      return undefined
    }
  }
  const v1 = await inScope({
    label: 'v1 sandboxes',
    run: async () => {
      const reconcile: SandboxStateReconciler = async ({ projectId, sandboxes }) =>
        reconcileStates({ projectId, sandboxes, now: args.now })
      return sweepOrphanSandboxes({
        stores: await args.deps.stores(),
        liveNames: args.deps.liveNames,
        retirableNames: args.deps.retirableNames,
        ignoreName: isPodSandboxName,
        onStopped: async ({ name }) => {
          await db.orm.public.CloudSandbox.where({ name }).update({
            state: ESandboxState.Parked,
            runtimeCheckpoint: null,
            runtimeCheckpointRevision: null,
            updatedAt: new Date(),
          })
        },
        reconcileStates: reconcile,
        now: args.now,
        dryRun: false,
        log,
      })
    },
  })
  if (v1 !== undefined) {
    failedScopes.push(...v1.failedScopes)
    succeeded += v1.projects - v1.failedScopes.length
  }
  if (succeeded === 0) {
    throw new Error(`orphan-sandbox-sweep could not run any scope: ${failedScopes.join(', ')}`)
  }
  return { v1: v1 ?? null, failedScopes }
}
