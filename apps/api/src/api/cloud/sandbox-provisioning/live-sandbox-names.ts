import { db, or } from '@dltech/atlas-db'
import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { ARCHIVED_SANDBOX_GRACE_MS } from './archived-sandbox-sweep'

export type V2Pods = {
  live: ReadonlySet<string>
  retirable: ReadonlySet<string>
  sessionIdsByPod: ReadonlyMap<string, string[]>
}

/**
 * A v2 pod is identified by the session that owns it: its `podSessionId`, or its own id for a root
 * pod (`COALESCE(podSessionId, id)` in `packages/control`). A pod is live while some session on it
 * can still resume it — unarchived, or archived inside the grace an unarchive can undo — and
 * retirable once every session on it is archived past that grace. The pod's provider name stays in
 * its adapter, so this is the only identity the sweep and the runtime share.
 */
export async function v2Pods(args: { now: Date }): Promise<V2Pods> {
  const cutoff = args.now.getTime() - ARCHIVED_SANDBOX_GRACE_MS
  const sessions = await db.orm.v2.V2Session.select('id', 'podSessionId', 'archivedAt').all()
  const byPod = new Map<string, { ids: string[]; live: boolean }>()
  for (const session of sessions) {
    const pod = session.podSessionId ?? session.id
    const entry = byPod.get(pod) ?? { ids: [], live: false }
    entry.ids.push(session.id)
    if (session.archivedAt === null || session.archivedAt.getTime() >= cutoff) entry.live = true
    byPod.set(pod, entry)
  }
  const live = new Set<string>()
  const retirable = new Set<string>()
  const sessionIdsByPod = new Map<string, string[]>()
  for (const [pod, entry] of byPod) {
    sessionIdsByPod.set(pod, entry.ids)
    if (entry.live) live.add(pod)
    else retirable.add(pod)
  }
  return { live, retirable, sessionIdsByPod }
}

/**
 * Re-checks one pod right before the sweep stops or deletes it: a session unarchived between the
 * listing and the action makes the pod live again, and it must not be touched. A pod whose rows are
 * gone is retirable — no session can resolve it any more.
 */
export async function podStillRetirable(args: {
  podSessionId: string
  now: Date
}): Promise<boolean> {
  const cutoff = args.now.getTime() - ARCHIVED_SANDBOX_GRACE_MS
  const sessions = await db.orm.v2.V2Session.where((session) =>
    or(session.id.eq(args.podSessionId), session.podSessionId.eq(args.podSessionId)),
  )
    .select('archivedAt')
    .all()
  return sessions.every(
    (session) => session.archivedAt !== null && session.archivedAt.getTime() < cutoff,
  )
}

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
