import { TEAMMATE_AGENT_TYPE } from '@dltech/atlas-core'
import type { SessionReader } from './fork-chain'
import {
  EThreadSubscriptionStatus,
  foldSubscriptions,
  type FoldedSubscription,
} from './subscription-fold'

export const SUBSCRIPTION_EVENT_TYPES = [
  'subscription-created',
  'subscription-changed',
  'subscription-ended',
]

export const PULL_REQUEST_PROVIDER_KIND = 'github.pull-request'

type EventRow = { threadId: string; seq: number; type: string; body: string }

export async function threadsSubscriptions(args: {
  reader: SessionReader
  threadIds: readonly string[]
}): Promise<Map<string, FoldedSubscription[]>> {
  const result = new Map<string, FoldedSubscription[]>()
  if (args.threadIds.length === 0) return result

  const rows = await args.reader.orm.public.Event.where((event) =>
    event.type.in(SUBSCRIPTION_EVENT_TYPES),
  )
    .where((event) => event.threadId.in([...args.threadIds]))
    .select('threadId', 'seq', 'type', 'body')
    .orderBy((event) => event.seq.asc())
    .all()

  const byThread = new Map<string, EventRow[]>()
  for (const row of rows) byThread.set(row.threadId, [...(byThread.get(row.threadId) ?? []), row])

  for (const threadId of args.threadIds) {
    result.set(threadId, foldSubscriptions(byThread.get(threadId) ?? []))
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

export async function teammateThreadIds(args: {
  reader: SessionReader
  threadIds: readonly string[]
}): Promise<Map<string, string[]>> {
  const teammates = new Map<string, string[]>()
  if (args.threadIds.length === 0) return teammates

  const rows = await args.reader.orm.public.Thread.where((thread) =>
    thread.spawnerThreadId.in([...args.threadIds]),
  )
    .where({ agentType: TEAMMATE_AGENT_TYPE })
    .select('id', 'spawnerThreadId')
    .all()
  for (const row of rows) {
    if (row.spawnerThreadId === null) continue
    teammates.set(row.spawnerThreadId, [...(teammates.get(row.spawnerThreadId) ?? []), row.id])
  }
  return teammates
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function activePullRequestSubscription(args: {
  subscriptions: readonly FoldedSubscription[]
  repoFullName: string
  prNumber: number
}): FoldedSubscription | undefined {
  const wantedRepo = `github.com/${args.repoFullName}`.toLowerCase()
  return args.subscriptions.find(({ status, provider, target }) => {
    if (status !== EThreadSubscriptionStatus.Active) return false
    if (provider !== PULL_REQUEST_PROVIDER_KIND) return false
    return (
      isRecord(target) &&
      typeof target.repo === 'string' &&
      target.repo.toLowerCase() === wantedRepo &&
      target.number === args.prNumber
    )
  })
}
