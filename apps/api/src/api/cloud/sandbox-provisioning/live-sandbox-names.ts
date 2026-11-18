import { db, or } from '@dltech/atlas-db'
import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { ARCHIVED_SANDBOX_GRACE_MS } from './archived-sandbox-sweep'

/** How `src/agent` derives its sandbox names (`sandboxNameOf` in sandbox/sandbox-provider.ts). */
const v2SandboxNameOf = (podSessionId: string): string => `atlas-v2-${podSessionId}`

export type V2PodNames = {
  live: ReadonlySet<string>
  retirable: ReadonlySet<string>
  sessionIdsByName: ReadonlyMap<string, string[]>
}

/**
 * A v2 pod is named by the session that owns it: its `podSessionId`, or its own id for a root pod
 * (`COALESCE(podSessionId, id)` in `packages/control`). A pod is live while some session on it can
 * still resume it — unarchived, or archived inside the grace an unarchive can undo — and retirable
 * once every session on it is archived past that grace.
 */
export async function v2PodNames(args: { now: Date }): Promise<V2PodNames> {
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
  const sessionIdsByName = new Map<string, string[]>()
  for (const [pod, entry] of byPod) {
    const name = v2SandboxNameOf(pod)
    sessionIdsByName.set(name, entry.ids)
    if (entry.live) live.add(name)
    else retirable.add(name)
  }
  return { live, retirable, sessionIdsByName }
}

/**
 * The names a running or resumable session can still resolve. Anything outside this set is storage
 * nobody can reach: resuming a pod looks it up by name, so a name with no live session behind it is
 * dead weight until it is deleted.
 */
/**
 * Names whose pod must not be running: nothing live can resume them. A v2 pod whose sessions are all
 * archived past the grace, and a cloud sandbox whose session is archived past it — archiving parks
 * the pod, and the grace lets an unarchive bring it back before this list lets the hourly sweep finish
 * the job.
 */
export async function retirableSandboxNames(args: { now: Date }): Promise<ReadonlySet<string>> {
  const names = new Set<string>((await v2PodNames({ now: args.now })).retirable)
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
  for (const name of (await v2PodNames({ now: args.now })).live) names.add(name)
  return names
}
