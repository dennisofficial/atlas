import { db } from '@dltech/atlas-db'

/** How `src/agent` names a sandbox (`sandboxNameOf` in agent/sandbox/sandbox-provider.ts). */
const V2_POD_NAME_PREFIX = 'atlas-v2-'

export function podSessionIdsOfSandboxNames(names: readonly string[]): string[] {
  return names
    .filter((name) => name.startsWith(V2_POD_NAME_PREFIX))
    .map((name) => name.slice(V2_POD_NAME_PREFIX.length))
}

/**
 * A v2 pod is named by the session that owns it: its `podSessionId`, or its own id for a root pod
 * (`COALESCE(podSessionId, id)` in `packages/control`).
 */
async function sessionIdsOnPods(args: { podSessionIds: readonly string[] }): Promise<string[]> {
  const pods = new Set(args.podSessionIds)
  const sessions = await db.orm.v2.V2Session.select('id', 'podSessionId').all()
  return sessions
    .filter((session) => pods.has(session.podSessionId ?? session.id))
    .map((session) => session.id)
}

/**
 * A terminal row belongs to the pod that hosted it. Once that pod is gone no daemon can ever report
 * the exit of the shells it ran, so the rows are ended here or they stay open forever.
 */
export async function endPodTerminals(args: { sandboxNames: readonly string[] }): Promise<number> {
  const podSessionIds = podSessionIdsOfSandboxNames(args.sandboxNames)
  if (podSessionIds.length === 0) return 0
  const endedAt = new Date()
  let ended = 0
  for (const sessionId of await sessionIdsOnPods({ podSessionIds })) {
    ended += await db.orm.v2.V2Terminal.where({ sessionId, state: 'open' }).updateAndCount({
      state: 'ended',
      endedReason: 'pod-slept',
      endedAt,
    })
  }
  return ended
}
