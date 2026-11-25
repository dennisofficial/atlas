import { db } from '@dltech/atlas-db'

/**
 * A v2 pod is identified by the session that owns it: its `podSessionId`, or its own id for a root
 * pod (`COALESCE(podSessionId, id)` in `packages/control`).
 */
async function sessionIdsOnPods(args: { podSessionIds: readonly string[] }): Promise<string[]> {
  const pods = new Set(args.podSessionIds)
  const sessions = await db.orm.public.Session.select('id', 'podSessionId').all()
  return sessions
    .filter((session) => pods.has(session.podSessionId ?? session.id))
    .map((session) => session.id)
}

/**
 * A terminal row belongs to the pod that hosted it. Once that pod is gone no daemon can ever report
 * the exit of the shells it ran, so the rows are ended here or they stay open forever.
 */
export async function endPodTerminals(args: { podSessionIds: readonly string[] }): Promise<number> {
  if (args.podSessionIds.length === 0) return 0
  const endedAt = new Date()
  let ended = 0
  for (const sessionId of await sessionIdsOnPods({ podSessionIds: args.podSessionIds })) {
    ended += await db.orm.public.Terminal.where({ sessionId, state: 'open' }).updateAndCount({
      state: 'ended',
      endedReason: 'pod-slept',
      endedAt,
    })
  }
  return ended
}
