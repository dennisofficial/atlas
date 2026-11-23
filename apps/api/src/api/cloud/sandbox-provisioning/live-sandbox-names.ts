import { db, or } from '@dltech/atlas-db'

import { ARCHIVED_SANDBOX_GRACE_MS } from '@dltech/atlas-pods'

import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'

/**
 * The v1 names whose sandbox must not be running: nothing live can resume them. A cloud sandbox
 * whose session is archived past the grace has been parked by archiving; the grace lets an
 * unarchive bring it back before this list lets the hourly sweep finish the job. v2 pods are
 * retired by `v2-pod-sweep.ts` instead.
 */
export async function retirableSandboxNames(args: { now: Date }): Promise<ReadonlySet<string>> {
  const names = new Set<string>()
  const cutoff = new Date(args.now.getTime() - ARCHIVED_SANDBOX_GRACE_MS)
  const archived = await db.orm.public.Session.where((session) => session.archivedAt.lt(cutoff))
    .select('id')
    .all()
  if (archived.length === 0) return names
  const rows = await db.orm.public.CloudSandbox.where((row) =>
    row.sessionId.in(archived.map((session) => session.id)),
  )
    .select('name')
    .all()
  for (const row of rows) names.add(row.name)
  return names
}

/**
 * The v1 names a running or resumable session can still resolve. Anything outside this set is
 * storage nobody can reach: resuming a cloud sandbox looks it up by name, so a name with no live
 * session behind it is dead weight until it is deleted. v2 pods are not named here — they belong to
 * the port-scoped sweep (`v2-pod-sweep.ts`), which identity-checks them by pod session id.
 */
export async function liveSandboxNames(args: { now: Date }): Promise<ReadonlySet<string>> {
  const cutoff = new Date(args.now.getTime() - ARCHIVED_SANDBOX_GRACE_MS)
  const sessions = await db.orm.public.Session.where((session) =>
    or(session.archivedAt.isNull(), session.archivedAt.gte(cutoff)),
  )
    .select('id')
    .all()
  const liveSessions = new Set(sessions.map((session) => session.id))
  const threads = await db.orm.public.Thread.select('id', 'sessionId').all()
  const names = new Set<string>()
  for (const thread of threads) {
    if (liveSessions.has(thread.sessionId)) names.add(sandboxNameFor({ threadId: thread.id }))
  }
  return names
}
