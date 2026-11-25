import { db } from '@dltech/atlas-db'
import { lockPodRetireIn } from '@dltech/atlas-control/postgres'
import {
  ARCHIVED_SANDBOX_GRACE_MS,
  endPodTerminals,
  podStillRetirableIn,
  recordSandboxRunClose,
  sweepV2Pods,
  type V2PodFence,
  type V2PodSweepScope,
  type V2PodSweepSummary,
  type V2Pods,
} from '@dltech/atlas-pods'
import { triggerLog } from '../trigger-logger'

const retirementFenceOf =
  (now: Date): V2PodFence =>
  async ({ podSessionId, act }) =>
    db.transaction(async (tx) => {
      await lockPodRetireIn({ tx, podSessionId })
      if (!(await podStillRetirableIn({ tx, podSessionId, now }))) return 'kept'
      await act()
      return 'acted'
    })

export type OrphanPodSweepDeps = {
  pods: () => Promise<V2Pods>
  v2Scopes: () => Promise<readonly V2PodSweepScope[]>
  softDeleteArchived: (args: { cutoff: Date; at: Date }) => Promise<number>
  markPreviewDeleting: (args: { podSessionId: string }) => Promise<void>
}

export type OrphanPodSweepRun = {
  v2: V2PodSweepSummary | null
  softDeleted: number | null
  failedScopes: string[]
}

export async function runOrphanPodSweep(args: {
  now: Date
  deps: OrphanPodSweepDeps
  log?: (line: string) => void
  fail?: (line: string) => void
}): Promise<OrphanPodSweepRun> {
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
          await args.deps
            .markPreviewDeleting({ podSessionId })
            .catch((failure: unknown) =>
              fail(`preview tunnel of ${podSessionId}: ${String(failure)}`),
            )
          const sessionIds = pods.sessionIdsByPod.get(podSessionId) ?? []
          if (sessionIds.length === 0) return
          await db.orm.public.Session.where((session) => session.id.in(sessionIds))
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
    throw new Error(`orphan-pod-sweep could not run any scope: ${failedScopes.join(', ')}`)
  }
  return {
    v2: v2 ?? null,
    softDeleted: softDeleted ?? null,
    failedScopes,
  }
}
