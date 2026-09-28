import { EPullRequestState, type EventDraft } from '../events/body'
import type { Event } from '../events/envelope'

export type LinkedPullRequest = {
  number: number
  url: string
  repo: string
  branch: string
}

type Link = {
  type: 'pull-request-linked'
  number: number
  url: string
  repo: string
  branch: string
}

const linked = (link: Link): LinkedPullRequest => ({
  number: link.number,
  url: link.url,
  repo: link.repo,
  branch: link.branch,
})

const identityOf = (link: { repo: string; number: number }): string =>
  `${link.repo}#${link.number}`

const fold = (links: readonly Link[], into: Map<string, LinkedPullRequest>): void => {
  for (const link of links) into.set(identityOf(link), linked(link))
}

/**
 * Oldest first, so the last entry is the pull request the session touched most recently. A repeat
 * link keeps its first position but refreshes the fields — a branch re-observed after a force-push
 * is the same pull request, not a new one.
 */
export function pullRequestsOf(events: readonly Event[]): readonly LinkedPullRequest[] {
  const byIdentity = new Map<string, LinkedPullRequest>()
  fold(events.filter((event): event is Event & Link => event.type === 'pull-request-linked'), byIdentity)
  return [...byIdentity.values()]
}

export function pullRequestsAfter(args: {
  drafts: readonly EventDraft[]
  linked: readonly LinkedPullRequest[]
}): readonly LinkedPullRequest[] {
  const drafts = args.drafts.filter(
    (draft): draft is EventDraft & Link => draft.type === 'pull-request-linked',
  )
  if (drafts.length === 0) return args.linked

  const byIdentity = new Map(args.linked.map((link) => [identityOf(link), link]))
  fold(drafts, byIdentity)
  return [...byIdentity.values()]
}

export type PullRequestState = {
  number: number
  url: string
  repo: string
  branch: string
  state: EPullRequestState
  checksRunning: number
  checksPassed: number
  checksFailed: number
  mergeable: boolean | null
  recordedAt: string
}

type StateRecord = {
  type: 'pull-request-state'
} & Omit<PullRequestState, never>

const recorded = (record: StateRecord): PullRequestState => ({
  number: record.number,
  url: record.url,
  repo: record.repo,
  branch: record.branch,
  state: record.state,
  checksRunning: record.checksRunning,
  checksPassed: record.checksPassed,
  checksFailed: record.checksFailed,
  mergeable: record.mergeable,
  recordedAt: record.recordedAt,
})

/**
 * Latest recorded state per pull request, oldest first. State events repeat as a reading moves
 * (checks landing, a merge closing it), so each entry is the freshest record for that identity,
 * and a repeat keeps its first position exactly as a repeat link does.
 */
export function pullRequestStatesOf(events: readonly Event[]): readonly PullRequestState[] {
  const byIdentity = new Map<string, PullRequestState>()
  for (const event of events) {
    if (event.type !== 'pull-request-state') continue
    byIdentity.set(identityOf(event), recorded(event))
  }
  return [...byIdentity.values()]
}
