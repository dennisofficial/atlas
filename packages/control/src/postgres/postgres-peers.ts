import type { Tx } from '@dltech/atlas-db'

export const claimPeerMessageIn = async (params: {
  tx: Tx
  sessionId: string
  budget: number
}): Promise<number | null> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`UPDATE "v2"."V2Session"
      SET "peerMessagesSent" = "peerMessagesSent" + 1
      WHERE "id" = ${params.sessionId} AND "peerMessagesSent" < ${params.budget}
      RETURNING "peerMessagesSent" AS "sent"`
      .returnsRow({ sent: 'pg/int4@1' })
      .build(),
  )
  return rows[0]?.sent ?? null
}

export const resetPeerMessagesIn = async (params: {
  tx: Tx
  sessionId: string
}): Promise<boolean> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`UPDATE "v2"."V2Session"
      SET "peerMessagesSent" = 0
      WHERE "id" = ${params.sessionId}
      RETURNING "id"`
      .returnsRow({ id: 'pg/text@1' })
      .build(),
  )
  return rows.length > 0
}

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
