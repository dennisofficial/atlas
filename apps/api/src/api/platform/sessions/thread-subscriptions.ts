import { REFERENCE_CHAIN_LIMIT, type SessionReader } from './fork-chain'
import {
  EThreadSubscriptionStatus,
  foldSubscriptions,
  type FoldedSubscription,
} from './subscription-fold'

const SUBSCRIPTION_EVENT_TYPES = [
  'subscription-created',
  'subscription-changed',
  'subscription-ended',
]

export const PULL_REQUEST_PROVIDER_KIND = 'github.pull-request'

type ForkLink = { parentThreadId: string; forkSeq: number }

type EventRow = { threadId: string; seq: number; type: string; body: string }

async function referenceLinksOf(args: {
  reader: SessionReader
  threadIds: readonly string[]
}): Promise<Map<string, ForkLink>> {
  const links = new Map<string, ForkLink>()
  const visited = new Set<string>()
  let frontier = [...new Set(args.threadIds)]

  for (let hop = 0; hop <= REFERENCE_CHAIN_LIMIT && frontier.length > 0; hop += 1) {
    for (const id of frontier) visited.add(id)
    const rows = await args.reader.orm.public.Thread.where((thread) => thread.id.in(frontier))
      .select('id', 'parentThreadId', 'forkSeq', 'forkMode')
      .all()
    const parents: string[] = []
    for (const row of rows) {
      if (row.forkMode !== 'reference') continue
      if (row.parentThreadId === null || row.forkSeq === null) continue
      links.set(row.id, { parentThreadId: row.parentThreadId, forkSeq: row.forkSeq })
      if (!visited.has(row.parentThreadId)) parents.push(row.parentThreadId)
    }
    frontier = [...new Set(parents)]
  }

  return links
}

function inheritedEvents(args: {
  threadId: string
  links: ReadonlyMap<string, ForkLink>
  byThread: ReadonlyMap<string, readonly EventRow[]>
}): EventRow[] {
  const segments: { threadId: string; upTo: number | undefined }[] = []
  let segment: { threadId: string; upTo: number | undefined } = {
    threadId: args.threadId,
    upTo: undefined,
  }

  for (let hop = 0; hop <= REFERENCE_CHAIN_LIMIT; hop += 1) {
    segments.unshift(segment)
    const link = args.links.get(segment.threadId)
    if (link === undefined) break
    segment = {
      threadId: link.parentThreadId,
      upTo: segment.upTo === undefined ? link.forkSeq : Math.min(segment.upTo, link.forkSeq),
    }
  }

  return segments.flatMap(({ threadId, upTo }) =>
    (args.byThread.get(threadId) ?? []).filter((event) => upTo === undefined || event.seq <= upTo),
  )
}

export async function threadsSubscriptions(args: {
  reader: SessionReader
  threadIds: readonly string[]
}): Promise<Map<string, FoldedSubscription[]>> {
  const result = new Map<string, FoldedSubscription[]>()
  if (args.threadIds.length === 0) return result

  const links = await referenceLinksOf(args)
  const involved = [
    ...new Set([...args.threadIds, ...[...links.values()].map((link) => link.parentThreadId)]),
  ]
  const rows = await args.reader.orm.public.Event.where((event) =>
    event.type.in(SUBSCRIPTION_EVENT_TYPES),
  )
    .where((event) => event.threadId.in(involved))
    .select('threadId', 'seq', 'type', 'body')
    .orderBy((event) => event.seq.asc())
    .all()

  const byThread = new Map<string, EventRow[]>()
  for (const row of rows) byThread.set(row.threadId, [...(byThread.get(row.threadId) ?? []), row])

  for (const threadId of args.threadIds) {
    result.set(threadId, foldSubscriptions(inheritedEvents({ threadId, links, byThread })))
  }
  return result
}

export async function threadSubscriptions(args: {
  reader: SessionReader
  threadId: string
}): Promise<FoldedSubscription[]> {
  const all = await threadsSubscriptions({ reader: args.reader, threadIds: [args.threadId] })
  return all.get(args.threadId) ?? []
}

export function activePullRequestSubscription(args: {
  subscriptions: readonly FoldedSubscription[]
  repoFullName: string
  prNumber: number
}): FoldedSubscription | undefined {
  const wanted = JSON.stringify({ repo: `github.com/${args.repoFullName}`, number: args.prNumber })
  return args.subscriptions.find(
    (subscription) =>
      subscription.status === EThreadSubscriptionStatus.Active &&
      subscription.provider === PULL_REQUEST_PROVIDER_KIND &&
      JSON.stringify(subscription.target) === wanted,
  )
}
