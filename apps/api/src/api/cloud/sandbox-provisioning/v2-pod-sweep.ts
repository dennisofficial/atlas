import { ESandboxProvider } from '@dltech/atlas-protocol'
import type { SandboxCredentials, SandboxListing, SandboxProvider } from '../../../agent'
import { ARCHIVED_SANDBOX_GRACE_MS } from './archived-sandbox-sweep'

const WORK_CONCURRENCY = 4

/** One provider's credentials and the adapter that holds the pods under them. */
export type V2PodSweepScope = {
  label: string
  credentials: SandboxCredentials
  sandbox: SandboxProvider
}

/** Pod session ids, the only identity the port knows a pod by. */
export type V2PodSweepPods = {
  live: ReadonlySet<string>
  retirable: ReadonlySet<string>
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
  dryRun: boolean
}

/**
 * A pod nothing live can resume is storage once it is stopped, so it is deleted. A *running* one is
 * left alone unless every session on it is archived past the grace (`retirable`), because a running
 * pod normally means someone is using it — stopping one parks it, and a later pass deletes it. The
 * grace covers a create in flight, which is a pod with no session row yet.
 */
export function planV2Pods(args: {
  pods: readonly SandboxListing[]
  live: ReadonlySet<string>
  retirable: ReadonlySet<string>
  now: Date
  graceMs?: number | undefined
}): V2PodPlan {
  const cutoff = args.now.getTime() - (args.graceMs ?? ARCHIVED_SANDBOX_GRACE_MS)
  const stop: string[] = []
  const doomed: string[] = []
  for (const pod of args.pods) {
    if (args.live.has(pod.sandboxSessionId)) continue
    if (pod.createdAt >= cutoff) continue
    if (pod.running) {
      if (args.retirable.has(pod.sandboxSessionId)) stop.push(pod.sandboxSessionId)
      continue
    }
    doomed.push(pod.sandboxSessionId)
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

/**
 * Every pod sandbox a provider holds is listed through the port and stopped or deleted by the same
 * rules as `planOrphanSandboxes`, for every provider rather than Vercel alone.
 */
export async function sweepV2Pods(args: {
  scopes: readonly V2PodSweepScope[]
  pods: V2PodSweepPods
  /** Re-read immediately before each stop or delete: a pod can come back to life after the list. */
  stillRetirable?: ((args: { podSessionId: string }) => Promise<boolean>) | undefined
  onRetired?: ((args: { podSessionId: string }) => Promise<void>) | undefined
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
    dryRun: args.dryRun,
  }
  for (const scope of args.scopes) {
    let listings: readonly SandboxListing[]
    try {
      listings = await scope.sandbox.list({ credentials: scope.credentials })
    } catch (failure) {
      summary.failed += 1
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
    const retirableNow = async (podSessionId: string): Promise<boolean> => {
      if (args.stillRetirable === undefined) return true
      try {
        return await args.stillRetirable({ podSessionId })
      } catch (failure) {
        failed(podSessionId)(failure)
        return false
      }
    }
    await runBounded({
      items: plan.stop,
      task: async (podSessionId) => {
        try {
          if (!(await retirableNow(podSessionId))) {
            summary.kept += 1
            return
          }
          await scope.sandbox.stop({ target: targetOf(podSessionId) })
          summary.stopped += 1
          swept.push(podSessionId)
        } catch (failure) {
          failed(podSessionId)(failure)
        }
      },
    })
    await runBounded({
      items: plan.delete,
      task: async (podSessionId) => {
        try {
          if (!(await retirableNow(podSessionId))) {
            summary.kept += 1
            return
          }
          await scope.sandbox.delete({ target: targetOf(podSessionId) })
          summary.deleted += 1
          swept.push(podSessionId)
        } catch (failure) {
          failed(podSessionId)(failure)
        }
      },
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
