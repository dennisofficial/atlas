import { db } from '@dltech/atlas-db'
import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'

/** How `apps/agent-host` derives its sandbox names (`sandboxNameOf` in sandbox/sandbox-provider.ts). */
const v2SandboxNameOf = (podSessionId: string): string => `atlas-v2-${podSessionId}`

export type V2PodNames = {
  live: ReadonlySet<string>
  retirable: ReadonlySet<string>
  sessionIdsByName: ReadonlyMap<string, string[]>
}

/**
 * A v2 pod is named by the session that owns it: its `podSessionId`, or its own id for a root pod
 * (`COALESCE(podSessionId, id)` in `packages/control`). A pod with no unarchived session on it is
 * retirable — nothing left to resume it.
 */
export async function v2PodNames(): Promise<V2PodNames> {
  const sessions = await db.orm.v2.V2Session.select('id', 'podSessionId', 'archivedAt').all()
  const byPod = new Map<string, { ids: string[]; live: boolean }>()
  for (const session of sessions) {
    const pod = session.podSessionId ?? session.id
    const entry = byPod.get(pod) ?? { ids: [], live: false }
    entry.ids.push(session.id)
    entry.live = entry.live || session.archivedAt === null
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
export async function liveSandboxNames(): Promise<ReadonlySet<string>> {
  const sessions = await db.orm.public.Session.where((session) => session.archivedAt.isNull())
    .select('id')
    .all()
  const liveSessions = new Set(sessions.map((session) => session.id))
  const threads = await db.orm.public.Thread.select('id', 'sessionId').all()
  const names = new Set<string>()
  for (const thread of threads) {
    if (liveSessions.has(thread.sessionId)) names.add(sandboxNameFor({ threadId: thread.id }))
  }
  for (const name of (await v2PodNames()).live) names.add(name)
  return names
}
