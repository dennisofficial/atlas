import { db } from '@dltech/atlas-db'
import { podSessionsOf } from '../../platform/sessions/session-of-thread'

/**
 * When each thread's pod was last active: a cloud sandbox's lastActivityAt, else a local pod's
 * lease refresh. A local pod has a lease and no CloudSandbox row.
 */
export async function threadActivityAt(args: {
  threadIds: readonly string[]
}): Promise<Map<string, Date>> {
  const activity = new Map<string, Date>()
  if (args.threadIds.length === 0) return activity
  const threadIds = [...new Set(args.threadIds)]
  const leases = await db.orm.public.LocalPodLease.where((lease) => lease.threadId.in(threadIds))
    .select('threadId', 'updatedAt')
    .all()
  for (const lease of leases) activity.set(lease.threadId, lease.updatedAt)
  const threads = await db.orm.public.Thread.where((thread) => thread.id.in(threadIds))
    .select('id', 'sessionId')
    .all()
  const sessions = await db.orm.public.Session.where((session) =>
    session.id.in(threads.map((thread) => thread.sessionId)),
  ).all()
  const podOf = await podSessionsOf({ reader: db, sessions })
  const sandboxes = await db.orm.public.CloudSandbox.where((sandbox) =>
    sandbox.sessionId.in([...new Set(podOf.values())]),
  )
    .select('sessionId', 'lastActivityAt')
    .all()
  const lastActive = new Map(
    sandboxes.map((sandbox) => [sandbox.sessionId, sandbox.lastActivityAt]),
  )
  for (const thread of threads) {
    const at = lastActive.get(podOf.get(thread.sessionId) ?? thread.sessionId)
    if (at !== undefined) activity.set(thread.id, at)
  }
  return activity
}
