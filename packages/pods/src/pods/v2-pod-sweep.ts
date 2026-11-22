import { ESandboxProvider } from '@dltech/atlas-protocol'
import type {
  SandboxCredentials,
  SandboxListing,
  SandboxProvider,
} from '../sandbox/sandbox-provider'
import { ARCHIVED_SANDBOX_GRACE_MS } from './archived-sandbox-grace'

const WORK_CONCURRENCY = 4

/** One provider's credentials and the adapter that holds the pods under them. */
export type V2PodSweepScope = {
  label: string
  credentials: SandboxCredentials
  sandbox: SandboxProvider
}

/**
 * Pod session ids, the only identity the port knows a pod by. `retirable` maps a pod to the latest
 * `archivedAt` of the sessions on it, in milliseconds.
 */
export type V2PodSweepPods = {
  live: ReadonlySet<string>
  retirable: ReadonlyMap<string, number>
}

export type V2PodPlan = { stop: string[]; delete: string[] }

/**
 * Two scopes with the same key list the same pods, so sweeping both would act on one pod twice. A
 * Vercel scope is an account and project whatever token it carries; Agent37 has one platform account.
 */
export const v2ScopeKeyOf = (credentials: SandboxCredentials): string =>
  credentials.provider === ESandboxProvider.Vercel
    ? `${credentials.provider}/${credentials.teamId}/${credentials.projectId}`
    : credentials.provider

export function uniqueV2Scopes(scopes: readonly V2PodSweepScope[]): V2PodSweepScope[] {
  const seen = new Set<string>()
  const unique: V2PodSweepScope[] = []
  for (const scope of scopes) {
    const key = v2ScopeKeyOf(scope.credentials)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(scope)
  }
  return unique
}

export type V2PodSweepSummary = {
  scopes: number
  scanned: number
  stopped: number
  deleted: number
  kept: number
  failed: number
  failedScopes: string[]
  dryRun: boolean
}

export type V2PodFenceOutcome = 'acted' | 'kept'

/** Re-check the pod and act on it as one step that no unarchive can split. */
export type V2PodFence = (args: {
  podSessionId: string
  act: () => Promise<void>
}) => Promise<V2PodFenceOutcome>

export function planV2Pods(args: {
  pods: readonly SandboxListing[]
  live: ReadonlySet<string>
  retirable: ReadonlyMap<string, number>
  now: Date
  graceMs?: number | undefined
}): V2PodPlan {
  const cutoff = args.now.getTime() - (args.graceMs ?? ARCHIVED_SANDBOX_GRACE_MS)
  const stop: string[] = []
  const doomed: string[] = []
  for (const pod of args.pods) {
    const podSessionId = pod.sandboxSessionId
    if (args.live.has(podSessionId)) continue
    const archivedAt = args.retirable.get(podSessionId)
    const pastGrace = archivedAt === undefined ? pod.createdAt < cutoff : archivedAt < cutoff
    if (!pastGrace) continue
    if (pod.running) stop.push(podSessionId)
    else doomed.push(podSessionId)
  }
  return { stop, delete: doomed }
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

export async function sweepV2Pods(args: {
  scopes: readonly V2PodSweepScope[]
  pods: V2PodSweepPods
  fence: V2PodFence
  onRetired?: ((args: { podSessionId: string }) => Promise<void>) | undefined
  onStopped?:
    | ((args: { podSessionId: string; cpuCumulativeMs?: number | undefined }) => Promise<void>)
    | undefined
  endTerminals?: ((args: { podSessionIds: readonly string[] }) => Promise<number>) | undefined
  now: Date
  dryRun: boolean
  log: (line: string) => void
  graceMs?: number | undefined
}): Promise<V2PodSweepSummary> {
  const summary: V2PodSweepSummary = {
    scopes: args.scopes.length,
    scanned: 0,
    stopped: 0,
    deleted: 0,
    kept: 0,
    failed: 0,
    failedScopes: [],
    dryRun: args.dryRun,
  }
  for (const scope of args.scopes) {
    let listings: readonly SandboxListing[]
    try {
      listings = await scope.sandbox.list({ credentials: scope.credentials })
    } catch (failure) {
      summary.failed += 1
      summary.failedScopes.push(scope.label)
      args.log(`${scope.label}: could not list its pods: ${String(failure)}`)
      continue
    }
    summary.scanned += listings.length
    const plan = planV2Pods({
      pods: listings,
      live: args.pods.live,
      retirable: args.pods.retirable,
      now: args.now,
      graceMs: args.graceMs,
    })
    summary.kept += listings.length - plan.stop.length - plan.delete.length
    args.log(
      `${scope.label}: ${listings.length} pods, ${plan.delete.length} unreachable, ${plan.stop.length} to stop${args.dryRun ? ' (dry run)' : ''}`,
    )
    if (args.dryRun) continue
    const swept: string[] = []
    const failed = (podSessionId: string) => (failure: unknown) => {
      summary.failed += 1
      args.log(`${scope.label}: ${podSessionId}: ${String(failure)}`)
    }
    const targetOf = (podSessionId: string) => ({
      sandboxSessionId: podSessionId,
      credentials: scope.credentials,
    })
    const cpuCumulativeMsBeforeRetire = async (
      podSessionId: string,
    ): Promise<number | undefined> => {
      try {
        return await scope.sandbox.activeCpuMs({ target: targetOf(podSessionId) })
      } catch {
        return undefined
      }
    }
    const retire = async (work: {
      podSessionId: string
      stopOrDelete: (target: ReturnType<typeof targetOf>) => Promise<void>
      count: () => void
    }): Promise<void> => {
      try {
        let cpuCumulativeMs: number | undefined
        const outcome = await args.fence({
          podSessionId: work.podSessionId,
          act: async () => {
            cpuCumulativeMs = await cpuCumulativeMsBeforeRetire(work.podSessionId)
            await work.stopOrDelete(targetOf(work.podSessionId))
          },
        })
        if (outcome === 'kept') {
          summary.kept += 1
          return
        }
        await args.onStopped?.({
          podSessionId: work.podSessionId,
          ...(cpuCumulativeMs === undefined ? {} : { cpuCumulativeMs }),
        })
        work.count()
        swept.push(work.podSessionId)
      } catch (failure) {
        failed(work.podSessionId)(failure)
      }
    }
    await runBounded({
      items: plan.stop,
      task: (podSessionId) =>
        retire({
          podSessionId,
          stopOrDelete: (target) => scope.sandbox.stop({ target }),
          count: () => {
            summary.stopped += 1
          },
        }),
    })
    await runBounded({
      items: plan.delete,
      task: (podSessionId) =>
        retire({
          podSessionId,
          stopOrDelete: (target) => scope.sandbox.delete({ target }),
          count: () => {
            summary.deleted += 1
          },
        }),
    })
    for (const podSessionId of swept) {
      try {
        await args.onRetired?.({ podSessionId })
      } catch (failure) {
        failed(podSessionId)(failure)
      }
    }
    if (swept.length === 0 || args.endTerminals === undefined) continue
    try {
      await args.endTerminals({ podSessionIds: swept })
    } catch (failure) {
      args.log(`could not end the terminals of ${swept.join(', ')}: ${String(failure)}`)
    }
  }
  return summary
}
