import type { Tx } from '@dltech/atlas-db'

export const livePodSessionsIn = async (params: {
  tx: Tx
  podSessionId: string
}): Promise<number> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT count(*)::int AS "count"
      FROM "public"."Session" s
      WHERE COALESCE(s."podSessionId", s."id") = ${params.podSessionId}
        AND s."archivedAt" IS NULL
        AND s."deletedAt" IS NULL`
      .returnsRow({ count: 'pg/int4@1' })
      .build(),
  )
  return rows[0]?.count ?? 0
}
