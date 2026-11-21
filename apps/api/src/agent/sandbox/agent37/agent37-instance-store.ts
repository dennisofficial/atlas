import type { Db } from '@dltech/atlas-db'

import type { Agent37InstanceIds } from './agent37-instances'

// A session's pod identity is COALESCE(podSessionId, id) (packages/control/src/postgres/
// postgres-peers.ts): podSessionId stays null until the pod reports one, so looking the row up by
// podSessionId alone finds nothing and every wake would create another instance.
const rowOf = async (db: Db, podSessionId: string) => {
  const byId = await db.orm.v2.V2Session.first({ id: podSessionId })
  if (byId !== null && byId.podSessionId === null) return byId
  return db.orm.v2.V2Session.first({ podSessionId })
}

export const agent37InstanceIdsOf = (db: Db): Agent37InstanceIds => ({
  find: async ({ podSessionId }) => {
    const row = await rowOf(db, podSessionId)
    return row?.sandboxInstanceId ?? null
  },
  remember: async ({ podSessionId, instanceId }) => {
    const row = await rowOf(db, podSessionId)
    if (row === null) return
    await db.orm.v2.V2Session.where({ id: row.id }).updateAndCount({
      sandboxInstanceId: instanceId,
    })
  },
  forget: async ({ podSessionId }) => {
    const row = await rowOf(db, podSessionId)
    if (row === null) return
    await db.orm.v2.V2Session.where({ id: row.id }).updateAndCount({ sandboxInstanceId: null })
  },
  seedStatus: async ({ podSessionId, status, at }) => {
    const row = await rowOf(db, podSessionId)
    if (row === null) return
    if (row.sandboxStatusAt !== null && row.sandboxStatusAt.getTime() >= Date.parse(at)) return
    await db.orm.v2.V2Session.where({ id: row.id }).updateAndCount({
      sandboxStatus: status,
      sandboxStatusAt: new Date(at),
    })
  },
})
