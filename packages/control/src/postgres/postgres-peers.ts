import type { Tx } from '@dltech/atlas-db'

import type { PodPlacedSession } from '../port'

export const podPeersPlacedIn = async (params: {
  tx: Tx
  podSessionId: string
  excludeSessionId: string
}): Promise<number> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT count(*)::int AS "count"
      FROM "v2"."V2Session" s
      WHERE COALESCE(s."podSessionId", s."id") = ${params.podSessionId}
        AND s."id" <> ${params.excludeSessionId}`
      .returnsRow({ count: 'pg/int4@1' })
      .build(),
  )
  return rows[0]?.count ?? 0
}

export const podSessionsPlacedIn = async (params: {
  tx: Tx
  podSessionId: string
}): Promise<PodPlacedSession[]> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT s."id" AS "sessionId", s."archivedAt" AS "archivedAt"
      FROM "v2"."V2Session" s
      WHERE COALESCE(s."podSessionId", s."id") = ${params.podSessionId}`
      .returnsRow({
        sessionId: 'pg/text@1',
        archivedAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
      })
      .build(),
  )
  return rows.map((row) => ({
    sessionId: row.sessionId,
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
  }))
}
