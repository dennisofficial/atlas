import { db, type Row } from '@dltech/atlas-db'

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
  const sandboxRows =
    threadIds.length === 0
      ? []
      : await db.orm.public.CloudSandbox.where((sandbox) => sandbox.threadId.in(threadIds)).all()
  return {
    subscriptions,
    sandboxes: new Map(sandboxRows.map((sandbox) => [sandbox.threadId, sandbox] as const)),
  }
}
