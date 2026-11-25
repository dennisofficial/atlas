import { and, or } from '@dltech/atlas-db'
import type { Db } from '@dltech/atlas-db'

import type { Agent37InstanceIds } from './agent37-instances'

// A session's pod identity is COALESCE(podSessionId, id) (packages/control/src/postgres/
// postgres-peers.ts): podSessionId stays null until the pod reports one, so looking the row up by
// podSessionId alone finds nothing and every wake would create another instance.
const rowOf = async (db: Db, podSessionId: string) => {
  const byId = await db.orm.public.Session.first({ id: podSessionId })
  if (byId !== null && byId.podSessionId === null) return byId
  return db.orm.public.Session.first({ podSessionId })
}

export const agent37InstanceIdsOf = (db: Db): Agent37InstanceIds => ({
  find: async ({ podSessionId }) => {
    const row = await rowOf(db, podSessionId)
    return row?.sandboxInstanceId ?? null
  },
  remember: async ({ podSessionId, instanceId }) => {
    const row = await rowOf(db, podSessionId)
    if (row === null) return
    await db.orm.public.Session.where({ id: row.id }).updateAndCount({
      sandboxInstanceId: instanceId,
    })
  },
  forget: async ({ podSessionId }) => {
    const row = await rowOf(db, podSessionId)
    if (row === null) return
    await db.orm.public.Session.where({ id: row.id }).updateAndCount({ sandboxInstanceId: null })
  },
  // The guard rides on the update itself: a webhook that lands between the row lookup and this
  // statement still wins, because the comparison happens inside the write.
  seedStatus: async ({ podSessionId, status, at }) => {
    const row = await rowOf(db, podSessionId)
    if (row === null) return
    const stamped = new Date(at)
    await db.orm.public.Session.where((session) =>
      and(
        session.id.eq(row.id),
        or(session.sandboxStatusAt.isNull(), session.sandboxStatusAt.lt(stamped)),
      ),
    ).updateAndCount({ sandboxStatus: status, sandboxStatusAt: stamped })
  },
})
