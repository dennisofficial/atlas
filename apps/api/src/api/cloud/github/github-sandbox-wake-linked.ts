import { db, type Row } from '@dltech/atlas-db'
import { podSessionOf, podSessionsOf } from '../../platform/sessions/session-of-thread'

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
    .where((subscription) => subscription.threadId.isNotNull())
    .all()
  const subscriptions = rows.flatMap((row) =>
    row.threadId === null ? [] : [{ threadId: row.threadId, liveUntil: row.liveUntil }],
  )
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
