import { db, type Row } from '@dltech/atlas-db'
import { podSessionsOf } from '../../platform/sessions/session-of-thread'
import { wakeClaimActive } from '../../platform/sandboxes/sandbox-lifecycle'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'

export const WAKE_FAILURE_BACKOFF_MS = 5 * 60 * 1_000

export type LinkedThreads = {
  subscriptions: Array<{ threadId: string; liveUntil: Date }>
  sandboxes: Map<string, Row<'CloudSandbox'>>
}

export async function linkedThreadsOf(args: {
  userId: string
  repoFullName: string
  prNumber: number
}): Promise<LinkedThreads> {
  const rows = await db.orm.public.GithubSubscription.where(args)
    .where((subscription) => subscription.threadId.neq(''))
    .all()
  const subscriptions = rows.map((row) => ({ threadId: row.threadId, liveUntil: row.liveUntil }))
  const threadIds = subscriptions.map((subscription) => subscription.threadId)
  return { subscriptions, sandboxes: await sandboxesOfThreads(threadIds) }
}

async function sandboxesOfThreads(threadIds: string[]): Promise<Map<string, Row<'CloudSandbox'>>> {
  if (threadIds.length === 0) return new Map()
  const threads = await db.orm.public.Thread.where((thread) => thread.id.in(threadIds))
    .select('id', 'sessionId')
    .all()
  const sessions = await db.orm.public.Session.where((session) =>
    session.id.in(threads.map((thread) => thread.sessionId)),
  ).all()
  const podOf = await podSessionsOf({ reader: db, sessions })
  const sandboxes = await db.orm.public.CloudSandbox.where((sandbox) =>
    sandbox.sessionId.in([...new Set(podOf.values())]),
  ).all()
  const bySession = new Map(sandboxes.map((sandbox) => [sandbox.sessionId, sandbox] as const))
  return new Map(
    threads.flatMap((thread) => {
      const sandbox = bySession.get(podOf.get(thread.sessionId) ?? thread.sessionId)
      return sandbox === undefined ? [] : [[thread.id, sandbox] as const]
    }),
  )
}

/**
 * The thread a failed wake still owes: the pod family's thread holding a `pr-event` wake intent
 * whose mailbox event no harness has acked. Returns undefined when every intent was consumed —
 * a failed boot whose intents all landed needs no retry.
 */
export async function owedIntentThreadOf(args: { sessionId: string }): Promise<string | undefined> {
  const threads = await db.orm.public.Thread.where({ sessionId: args.sessionId }).select('id').all()
  const threadIds = threads.map((thread) => thread.id)
  if (threadIds.length === 0) return undefined

  const intents = await db.orm.public.Event.where((event) => event.threadId.in(threadIds))
    .where({ type: 'pr-event' })
    .select('threadId', 'body')
    .all()
  const owed = new Map<string, Set<string>>()
  for (const intent of intents) {
    const eventId = eventIdOfIntentBody(intent.body)
    if (eventId === undefined) continue
    const set = owed.get(intent.threadId) ?? new Set<string>()
    set.add(eventId)
    owed.set(intent.threadId, set)
  }
  if (owed.size === 0) return undefined

  const eventIds = [...owed.values()].flatMap((set) => [...set])
  const acked = await db.orm.public.GithubPrEventDelivery.where((delivery) =>
    delivery.eventId.in(eventIds),
  )
    .where((delivery) => delivery.ackedAt.isNotNull())
    .select('eventId')
    .all()
  const ackedIds = new Set(acked.map((row) => row.eventId))
  for (const [threadId, set] of owed) {
    if ([...set].some((eventId) => !ackedIds.has(eventId))) return threadId
  }
  return undefined
}

function eventIdOfIntentBody(body: string): string | undefined {
  if (!body.includes('"wakeKey"')) return undefined
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const eventId = (parsed as Record<string, unknown>).eventId
    return typeof eventId === 'string' && eventId.length > 0 ? eventId : undefined
  } catch {
    return undefined
  }
}

export type FailedWakeTarget = {
  threadId: string
  sandbox: Row<'CloudSandbox'>
}

/**
 * Boot-failure retry scan: parked sandboxes whose last wake failed past its backoff and whose
 * pod's threads still hold an unconsumed wake intent. A wake intent with no matching `ackedAt`
 * means no harness journaled the mailbox event it carries, so the wake is still owed.
 */
export async function failedWakeTargets(): Promise<FailedWakeTarget[]> {
  const backoffCutoff = new Date(Date.now() - WAKE_FAILURE_BACKOFF_MS)
  const failed = await db.orm.public.CloudSandbox.where({ state: ESandboxState.Parked })
    .where((sandbox) => sandbox.wakeFailedAt.isNotNull())
    .all()
  const retryable = failed.filter(
    (sandbox) =>
      sandbox.wakeFailedAt !== null &&
      sandbox.wakeFailedAt < backoffCutoff &&
      !wakeClaimActive(sandbox),
  )
  const targets: FailedWakeTarget[] = []
  for (const sandbox of retryable) {
    const threadId = await owedIntentThreadOf({ sessionId: sandbox.sessionId })
    if (threadId !== undefined) targets.push({ threadId, sandbox })
  }
  return targets
}
