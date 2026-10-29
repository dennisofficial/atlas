import { db } from '@dltech/atlas-db'

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
  const sandboxes = await db.orm.public.CloudSandbox.where((sandbox) =>
    sandbox.threadId.in(threadIds),
  )
    .select('threadId', 'lastActivityAt')
    .all()
  for (const sandbox of sandboxes) activity.set(sandbox.threadId, sandbox.lastActivityAt)
  return activity
}
