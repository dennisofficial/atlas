import type { Tx } from '@dltech/atlas-db'
import { PG_PRESENCE_LOCK_NAMESPACE } from '@dltech/atlas-protocol'

export const hostPresentIn = async (params: { tx: Tx; hostId: number }): Promise<boolean> => {
  const [row] = await params.tx.query(
    params.tx.raw.sql`SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND granted AND mode = 'ExclusiveLock'
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND classid = ${PG_PRESENCE_LOCK_NAMESPACE}::oid AND objid = ${params.hostId}::oid
          AND objsubid = 2
      )::text AS "present"`
      .returnsRow({ present: 'pg/text@1' })
      .build(),
  )
  return row?.present === 'true'
}

export const hostsPresentIn = async (params: {
  tx: Tx
  hostIds: readonly number[]
}): Promise<ReadonlySet<number>> => {
  if (params.hostIds.length === 0) return new Set()
  const wanted = new Set(params.hostIds)
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT objid::int AS "hostId" FROM pg_locks
        WHERE locktype = 'advisory' AND granted AND mode = 'ExclusiveLock'
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND classid = ${PG_PRESENCE_LOCK_NAMESPACE}::oid AND objsubid = 2`
      .returnsRow({ hostId: 'pg/int4@1' })
      .build(),
  )
  return new Set(rows.map((row) => row.hostId).filter((hostId) => wanted.has(hostId)))
}
