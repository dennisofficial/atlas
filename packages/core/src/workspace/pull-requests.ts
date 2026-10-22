import type { EventDraft } from '../events/body'
import type { Event } from '../events/envelope'
import type { ThreadId } from '../events/ids'

export type LinkedPullRequest = {
  number: number
  url: string
  repo: string
  branch: string
  worktreePath?: string | undefined
  linkedBy?: ThreadId | undefined
}

type Link = {
  type: 'pull-request-linked'
  number: number
  url: string
  repo: string
  branch: string
  worktreePath?: string | undefined
  threadId?: ThreadId | undefined
}

const linked = (link: Link): LinkedPullRequest => ({
  number: link.number,
  url: link.url,
  repo: link.repo,
  branch: link.branch,
  worktreePath: link.worktreePath,
  linkedBy: link.threadId,
})

const identityOf = (link: { repo: string; number: number }): string => `${link.repo}#${link.number}`

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
  fold(
    events.filter((event): event is Event & Link => event.type === 'pull-request-linked'),
    byIdentity,
  )
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
