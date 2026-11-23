import { db, or, type Tx } from '@dltech/atlas-db'
import { controlTxOf } from '@dltech/atlas-control/postgres'

import { ARCHIVED_SANDBOX_GRACE_MS } from './archived-sandbox-grace'

export type V2Pods = {
  live: ReadonlySet<string>
  retirable: ReadonlyMap<string, number>
  sessionIdsByPod: ReadonlyMap<string, string[]>
}

type PodEntry = { ids: string[]; live: boolean; archivedAt: number }

async function sessionsInUseIn(args: {
  tx: Tx
  sessionIds: readonly string[]
}): Promise<ReadonlySet<string>> {
  if (args.sessionIds.length === 0) return new Set()
  const openRuns = await args.tx.orm.v2.V2SandboxRun.where((run) =>
    run.sessionId.in([...args.sessionIds]),
  )
    .where((run) => run.endedAt.isNull())
    .select('sessionId')
    .all()
  const control = controlTxOf(args.tx)
  const leases = await control.readLeases(args.sessionIds)
  const holderIds = leases.flatMap((lease) =>
    lease.holderHostId === null ? [] : [lease.holderHostId],
  )
  const present = await control.hostsPresent(holderIds)
  const held = leases
    .filter((lease) => lease.holderHostId !== null && present.has(lease.holderHostId))
    .map((lease) => lease.sessionId)
  return new Set([...openRuns.map((run) => run.sessionId), ...held])
}

const sessionsInUse = (args: { sessionIds: readonly string[] }): Promise<ReadonlySet<string>> =>
  db.transaction((tx) => sessionsInUseIn({ tx, sessionIds: args.sessionIds }))

/**
 * A v2 pod is identified by the session that owns it: its `podSessionId`, or its own id for a root
 * pod (`COALESCE(podSessionId, id)` in `packages/control`). A pod is live while some session on it
 * can still resume it — unarchived, archived inside the grace an unarchive can undo, or still in
 * use by a running sandbox run or a held lease — and retirable once every session on it is
 * archived past that grace and nothing is running on it. The map carries the latest `archivedAt`,
 * because the grace counts from archive and not from the pod's creation. The pod's provider name
 * stays in its adapter, so this is the only identity the sweep and the runtime share.
 */
export async function v2Pods(args: { now: Date }): Promise<V2Pods> {
  const cutoff = args.now.getTime() - ARCHIVED_SANDBOX_GRACE_MS
  const sessions = await db.orm.v2.V2Session.select('id', 'podSessionId', 'archivedAt').all()
  const byPod = new Map<string, PodEntry>()
  for (const session of sessions) {
    const pod = session.podSessionId ?? session.id
    const entry = byPod.get(pod) ?? { ids: [], live: false, archivedAt: 0 }
    entry.ids.push(session.id)
    if (session.archivedAt === null || session.archivedAt.getTime() >= cutoff) entry.live = true
    else entry.archivedAt = Math.max(entry.archivedAt, session.archivedAt.getTime())
    byPod.set(pod, entry)
  }
  const inUse = await sessionsInUse({ sessionIds: sessions.map((session) => session.id) })
  const live = new Set<string>()
  const retirable = new Map<string, number>()
  const sessionIdsByPod = new Map<string, string[]>()
  for (const [pod, entry] of byPod) {
    sessionIdsByPod.set(pod, entry.ids)
    if (entry.live || entry.ids.some((id) => inUse.has(id))) live.add(pod)
    else retirable.set(pod, entry.archivedAt)
  }
  return { live, retirable, sessionIdsByPod }
}

/** Re-checks one pod inside the transaction that holds its retirement fence. */
export async function podStillRetirableIn(args: {
  tx: Tx
  podSessionId: string
  now: Date
}): Promise<boolean> {
  const cutoff = args.now.getTime() - ARCHIVED_SANDBOX_GRACE_MS
  const sessions = await args.tx.orm.v2.V2Session.where((session) =>
    or(session.id.eq(args.podSessionId), session.podSessionId.eq(args.podSessionId)),
  )
    .select('id', 'archivedAt')
    .all()
  const archivedPast = sessions.every(
    (session) => session.archivedAt !== null && session.archivedAt.getTime() < cutoff,
  )
  if (!archivedPast) return false
  const inUse = await sessionsInUseIn({ tx: args.tx, sessionIds: sessions.map((s) => s.id) })
  return inUse.size === 0
}

export async function podStillRetirable(args: {
  podSessionId: string
  now: Date
}): Promise<boolean> {
  return db.transaction((tx) =>
    podStillRetirableIn({ tx, podSessionId: args.podSessionId, now: args.now }),
  )
}
