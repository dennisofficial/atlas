import { db } from '@dltech/atlas-db'
import { lockPodRetireIn } from '@dltech/atlas-control/postgres'
import { ARCHIVED_SANDBOX_GRACE_MS } from '../../api/cloud/sandbox-provisioning/archived-sandbox-sweep'
import { ESandboxState } from '../../api/platform/sandboxes/sandboxes.types'
import {
  podStillRetirableIn,
  type V2Pods,
} from '../../api/cloud/sandbox-provisioning/live-sandbox-names'
import {
  planSandboxStateReconcile,
  sweepOrphanSandboxes,
  type OrphanSandbox,
  type OrphanSandboxProject,
  type OrphanSweepSummary,
  type SandboxStateReconciler,
} from '../../api/cloud/sandbox-provisioning/orphan-sandbox-sweep'
import {
  sweepV2Pods,
  type V2PodFence,
  type V2PodSweepScope,
  type V2PodSweepSummary,
} from '../../api/cloud/sandbox-provisioning/v2-pod-sweep'
import { endPodTerminals } from '../../api/platform/sandboxes/pod-terminals'
import { recordSandboxRunClose } from '../../agent/sandbox/sandbox-runs'
import { isPodSandboxName } from '../../agent/sandbox/vercel-names'
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

const retirementFenceOf =
  (now: Date): V2PodFence =>
  async ({ podSessionId, act }) =>
    db.transaction(async (tx) => {
      await lockPodRetireIn({ tx, podSessionId })
      if (!(await podStillRetirableIn({ tx, podSessionId, now }))) return 'kept'
      await act()
      return 'acted'
    })

export type OrphanSweepDeps = {
  pods: () => Promise<V2Pods>
  v2Scopes: () => Promise<readonly V2PodSweepScope[]>
  stores: () => Promise<readonly OrphanSandboxProject[]>
  liveNames: () => Promise<ReadonlySet<string>>
  retirableNames: () => Promise<ReadonlySet<string>>
  softDeleteArchived: (args: { cutoff: Date; at: Date }) => Promise<number>
}

export type OrphanSweepRun = {
  v1: OrphanSweepSummary | null
  v2: V2PodSweepSummary | null
  softDeleted: number | null
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
  const v2 = await inScope({
    label: 'v2 pods',
    run: async () => {
      const pods = await args.deps.pods()
      return sweepV2Pods({
        scopes: await args.deps.v2Scopes(),
        pods,
        fence: retirementFenceOf(args.now),
        onRetired: async ({ podSessionId }) => {
          const sessionIds = pods.sessionIdsByPod.get(podSessionId) ?? []
          if (sessionIds.length === 0) return
          await db.orm.v2.V2Session.where((session) => session.id.in(sessionIds))
            .where((session) => session.archivedAt.isNotNull())
            .updateAndCount({ podRetiredAt: new Date() })
        },
        onStopped: async ({ podSessionId, cpuCumulativeMs }) => {
          await recordSandboxRunClose({
            sessionId: podSessionId,
            ...(cpuCumulativeMs === undefined ? {} : { cpuCumulativeMs }),
          })
        },
        endTerminals: (terminals) => endPodTerminals(terminals),
        now: args.now,
        dryRun: false,
        log,
      })
    },
  })
  if (v2 !== undefined) {
    failedScopes.push(...v2.failedScopes)
    succeeded += v2.scopes - v2.failedScopes.length
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
  const softDeleted = await inScope({
    label: 'archive retention',
    run: () =>
      args.deps.softDeleteArchived({
        cutoff: new Date(args.now.getTime() - ARCHIVED_SANDBOX_GRACE_MS),
        at: args.now,
      }),
  })
  if (softDeleted !== undefined) {
    succeeded += 1
    log(`soft-deleted ${softDeleted} v2 sessions archived past the grace`)
  }
  if (succeeded === 0) {
    throw new Error(`orphan-sandbox-sweep could not run any scope: ${failedScopes.join(', ')}`)
  }
  return {
    v1: v1 ?? null,
    v2: v2 ?? null,
    softDeleted: softDeleted ?? null,
    failedScopes,
  }
}
