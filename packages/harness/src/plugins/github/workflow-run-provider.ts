import type { EventDraft, Subscription, ThreadId } from '@dltech/atlas-core'

import {
  EOccurrenceUrgency,
  type SubscriptionOccurrence,
  type SubscriptionProvider,
} from '../../subscriptions/provider'
import { probeCheckout } from './checkout-probe'
import type { FamilyTracker } from './family-tracker'
import type { RepositoryCheckout } from './pure'
import {
  createGhWorkflowRunReader,
  RUN_COMPLETED,
  type WorkflowRunReader,
  type WorkflowRunReading,
} from './workflow-run-reader'
import {
  EWorkflowRunTargetKind,
  resolveWorkflowRunTarget,
  targetKey,
  targetOf,
  workflowRunRepoOf,
  type FoundRun,
  type WorkflowRunTarget,
} from './workflow-run-target'

export const WORKFLOW_RUN_PROVIDER_KIND = 'github.workflow-run'

export const WORKFLOW_RUN_TICK_MS = 5_000

const GITHUB_PREFIX = 'github.com/'

const SCHEME = /^https?:\/\//

export type WorkflowRunProvider = SubscriptionProvider & {
  subscribedRun: (args: { repo: string; branch: string }) => boolean
}

type Emit = (occurrence: SubscriptionOccurrence) => void

type Watch = {
  subscription: Subscription
  target: WorkflowRunTarget
  emit: Emit
  seen: Set<number>
  seeded: boolean
  timer: ReturnType<typeof setInterval> | null
  reading: boolean
  stopped: boolean
}

const slugOf = (repo: string): string => {
  const lowered = repo.trim().toLowerCase().replace(SCHEME, '').replace(/\/+$/, '')
  return lowered.startsWith(GITHUB_PREFIX) ? lowered.slice(GITHUB_PREFIX.length) : lowered
}

const occurrenceOf = (args: {
  repo: string
  reading: WorkflowRunReading
}): SubscriptionOccurrence => {
  const { reading } = args
  const eventId = `run-wake:${reading.runId}:${reading.conclusion}`
  const failedJobs = reading.failedJobs ?? []
  const draft: EventDraft = {
    type: 'run-event',
    repo: args.repo,
    workflowRunId: reading.runId,
    workflow: reading.workflow,
    branch: reading.branch,
    url: reading.url,
    status: reading.status,
    conclusion: reading.conclusion,
    eventId,
    ...(reading.headSha.length === 0 ? {} : { headSha: reading.headSha }),
    ...(failedJobs.length === 0 ? {} : { failedJobs }),
  }

  return { key: eventId, urgency: EOccurrenceUrgency.Now, ends: true, draft }
}

const completedIn = (readings: readonly WorkflowRunReading[]): readonly WorkflowRunReading[] =>
  readings.filter((reading) => reading.status === RUN_COMPLETED)

export function createWorkflowRunProvider(args: {
  tracker: Pick<FamilyTracker, 'checkoutFor'>
  reader?: WorkflowRunReader
  probe?: typeof probeCheckout
  tickMs?: number
}): WorkflowRunProvider {
  const probe = args.probe ?? probeCheckout
  const reader = args.reader ?? createGhWorkflowRunReader()
  const tickMs = args.tickMs ?? WORKFLOW_RUN_TICK_MS
  const watches = new Map<string, Watch>()

  const checkoutOf = async (request: {
    threadId: ThreadId
    projectDirectory: string
  }): Promise<RepositoryCheckout | null> =>
    args.tracker.checkoutFor({ threadId: request.threadId }) ??
    (await probe({ directory: request.projectDirectory }))

  const latestOf = async (request: {
    repo: string
    checkout: RepositoryCheckout
  }): Promise<FoundRun | null> => {
    try {
      const reading = await reader.latest({
        repo: request.repo,
        directory: request.checkout.directory,
        branch: request.checkout.branch,
      })
      return reading === null ? null : { runId: reading.runId, workflow: reading.workflow }
    } catch {
      return null
    }
  }

  const stop = (watch: Watch): void => {
    watch.stopped = true
    if (watch.timer !== null) clearInterval(watch.timer)
    watch.timer = null
    watches.delete(watch.subscription.id)
  }

  const pinnedOccurrence = async (watch: Watch): Promise<SubscriptionOccurrence | null> => {
    if (watch.target.kind !== EWorkflowRunTargetKind.Run) return null

    const reading = await reader.pin({
      repo: watch.target.repo,
      runId: watch.target.runId,
    })
    if (reading === null || reading.status !== RUN_COMPLETED) return null

    return occurrenceOf({ repo: watch.target.repo, reading })
  }

  const selectorOccurrence = async (watch: Watch): Promise<SubscriptionOccurrence | null> => {
    if (watch.target.kind !== EWorkflowRunTargetKind.Selector) return null

    const readings = completedIn(
      await reader.selector({
        repo: watch.target.repo,
        workflow: watch.target.workflow,
        branch: watch.target.branch,
      }),
    )
    if (!watch.seeded) {
      watch.seeded = true
      for (const reading of readings) watch.seen.add(reading.runId)
      return null
    }

    const fresh = readings.find((reading) => !watch.seen.has(reading.runId))
    return fresh === undefined ? null : occurrenceOf({ repo: watch.target.repo, reading: fresh })
  }

  const poll = async (watch: Watch): Promise<void> => {
    if (watch.stopped || watch.reading) return

    watch.reading = true
    try {
      const occurrence =
        watch.target.kind === EWorkflowRunTargetKind.Selector
          ? await selectorOccurrence(watch)
          : await pinnedOccurrence(watch)
      if (occurrence === null || watch.stopped) return

      watch.emit(occurrence)
      stop(watch)
    } catch {
      return
    } finally {
      watch.reading = false
    }
  }

  const start = (args: { subscription: Subscription; emit: Emit }): (() => void) => {
    const target = targetOf(args.subscription.target)
    if (target === null) return () => undefined

    const watch: Watch = {
      subscription: args.subscription,
      target,
      emit: args.emit,
      seen: new Set(),
      seeded: false,
      timer: null,
      reading: false,
      stopped: false,
    }
    watches.set(args.subscription.id, watch)

    void poll(watch)
    const timer = setInterval(() => void poll(watch), tickMs)
    timer.unref?.()
    watch.timer = timer

    return () => stop(watch)
  }

  return {
    kind: WORKFLOW_RUN_PROVIDER_KIND,
    summary: 'Workflow run events: a run finishing (success, failure, cancelled).',
    targetHint:
      'Blank for this push\u2019s run, or #<run id>, owner/repo#<run id>, a run URL, or <workflow>@<branch>.',
    resolve: async ({ input, threadId, projectDirectory }) => {
      const checkout = await checkoutOf({ threadId, projectDirectory })
      const repo = workflowRunRepoOf(checkout)
      const foundRun =
        input.trim().length === 0 && repo !== null && checkout !== null
          ? await latestOf({ repo, checkout })
          : null

      return resolveWorkflowRunTarget({ input, checkout, foundRun })
    },
    start,
    subscribedRun: ({ repo, branch }) => {
      const wanted = slugOf(repo)
      for (const watch of watches.values()) {
        if (watch.stopped) continue
        if (slugOf(watch.target.repo) !== wanted) continue
        if (watch.target.kind !== EWorkflowRunTargetKind.Selector) return true
        if (watch.target.branch === branch) return true
      }

      return false
    },
  }
}
