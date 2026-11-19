import type { Db } from '@dltech/atlas-db'

import type { Agent37InstanceIds } from './agent37-instances'

export const agent37InstanceIdsOf = (db: Db): Agent37InstanceIds => ({
  find: async ({ podSessionId }) => {
    const row = await db.orm.v2.V2Session.first({ podSessionId })
    return row?.sandboxInstanceId ?? null
  },
  remember: async ({ podSessionId, instanceId }) => {
    const row = await db.orm.v2.V2Session.first({ podSessionId })
    if (row === null) return
    await db.orm.v2.V2Session.where({ id: row.id }).updateAndCount({
      sandboxInstanceId: instanceId,
    })
  },
})
