import {
  EPrEventKind,
  EPullRequestState,
  ESubscriptionActor,
  ESubscriptionEnd,
  type Event,
  type V2Event,
} from '@dltech/atlas-core'

import { GITHUB_RUN_PROVIDER, runTargetOf } from './run-target'
import {
  foldSubscriptions,
  type SubscriptionRow,
  type SubscriptionsViewState,
} from './subscriptions-view'
import { GITHUB_PROVIDER, targetOf } from './target'

export type SubscriptionEnding = {
  subscriptionId: string
  reason: ESubscriptionEnd
  by: ESubscriptionActor
}

type PrEvent = Extract<Event | V2Event, { type: 'pr-event' }>
type RunEvent = Extract<Event | V2Event, { type: 'run-event' }>

const TERMINAL_PR_STATES: readonly string[] = [EPullRequestState.Merged, EPullRequestState.Closed]

const repoKeyOf = (repo: string): string =>
  repo
    .trim()
    .toLowerCase()
    .replace(/^github\.com\//, '')

const endsPullRequest = (args: { row: SubscriptionRow; event: PrEvent }): boolean => {
  if (args.row.provider !== GITHUB_PROVIDER) return false
  if (args.event.kind !== EPrEventKind.State) return false
  if (!TERMINAL_PR_STATES.includes(args.event.state ?? '')) return false
  const target = targetOf(args.row.target)
  if (target === null) return false
  return (
    target.number === args.event.prNumber && repoKeyOf(target.repo) === repoKeyOf(args.event.repo)
  )
}

const endsPinnedRun = (args: { row: SubscriptionRow; event: RunEvent }): boolean => {
  if (args.row.provider !== GITHUB_RUN_PROVIDER) return false
  const target = runTargetOf(args.row.target)
  if (target === null || target.kind !== 'run') return false
  return (
    target.runId === args.event.workflowRunId &&
    repoKeyOf(target.repo) === repoKeyOf(args.event.repo)
  )
}

const completes = (args: { row: SubscriptionRow; event: PrEvent | RunEvent }): boolean =>
  args.event.type === 'pr-event'
    ? endsPullRequest({ row: args.row, event: args.event })
    : endsPinnedRun({ row: args.row, event: args.event })

const expiryOf = (row: SubscriptionRow): number | null => {
  if (row.expiresAt === undefined) return null
  const at = Date.parse(row.expiresAt)
  return Number.isFinite(at) ? at : null
}

const completed = (args: {
  live: SubscriptionsViewState
  event: PrEvent | RunEvent
}): SubscriptionRow[] => args.live.filter((row) => completes({ row, event: args.event }))

export const subscriptionEndingsOf = (args: {
  events: readonly (Event | V2Event)[]
  now: Date
}): SubscriptionEnding[] => {
  const endings = new Map<string, SubscriptionEnding>()
  let live: SubscriptionsViewState = []

  for (const event of args.events) {
    if (event.type === 'pr-event' || event.type === 'run-event') {
      const finishing = completed({ live, event })
      const ids = new Set(finishing.map((row) => row.id))
      for (const row of finishing) {
        if (endings.has(row.id)) continue
        endings.set(row.id, {
          subscriptionId: row.id,
          reason: ESubscriptionEnd.Completed,
          by: ESubscriptionActor.Provider,
        })
      }
      live = live.filter((row) => !ids.has(row.id))
    }
    if (event.type === 'subscription-created' || event.type === 'subscription-ended')
      endings.delete(event.subscriptionId)
    live = foldSubscriptions(live, event)
  }

  for (const row of live) {
    const expiresAt = expiryOf(row)
    if (expiresAt === null || expiresAt > args.now.getTime()) continue
    endings.set(row.id, {
      subscriptionId: row.id,
      reason: ESubscriptionEnd.Expired,
      by: ESubscriptionActor.Clock,
    })
  }

  return [...endings.values()]
}
