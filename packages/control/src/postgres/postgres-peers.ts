import type { Tx } from '@dltech/atlas-db'

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
