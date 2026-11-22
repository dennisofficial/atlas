import type { Tx } from '@dltech/atlas-db'

export const POD_RETIRE_LOCK_NAMESPACE = 1095060564

export const lockPodRetireIn = async (params: { tx: Tx; podSessionId: string }): Promise<void> => {
  await params.tx.query(
    params.tx.raw
      .sql`SELECT pg_advisory_xact_lock(${POD_RETIRE_LOCK_NAMESPACE}::int, hashtext('pod-retire:' || ${params.podSessionId})::int)::text AS "locked"`
      .returnsRow({ locked: 'pg/text@1' })
      .build(),
  )
}

export const lockPodRetireOfSessionIn = async (params: {
  tx: Tx
  sessionId: string
}): Promise<void> => {
  await params.tx.query(
    params.tx.raw
      .sql`SELECT pg_advisory_xact_lock(${POD_RETIRE_LOCK_NAMESPACE}::int, hashtext('pod-retire:' || COALESCE(s."podSessionId", s."id"))::int)::text AS "locked"
        FROM "v2"."V2Session" s
        WHERE s."id" = ${params.sessionId}`
      .returnsRow({ locked: 'pg/text@1' })
      .build(),
  )
}
