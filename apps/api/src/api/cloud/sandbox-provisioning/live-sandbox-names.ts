import { db } from '@dltech/atlas-db'
import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'

/** How `apps/agent-host` derives its sandbox names (`sandboxNameOf` in sandbox/sandbox-provider.ts). */
const v2SandboxNameOf = (podSessionId: string): string => `atlas-v2-${podSessionId}`

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
  const peerSessions = await db.orm.v2.V2Session.where((session) => session.archivedAt.isNull())
    .select('podSessionId')
    .all()
  for (const session of peerSessions) {
    if (session.podSessionId !== null) names.add(v2SandboxNameOf(session.podSessionId))
  }
  return names
}
