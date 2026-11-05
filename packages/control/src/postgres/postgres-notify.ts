import type { Tx } from '@dltech/atlas-db'
import { PG_CHANGE_CHANNEL, PG_WAKE_CHANNEL, type SessionChange } from '@dltech/atlas-protocol'

export const notifyWakeIn = async (params: { tx: Tx; sessionId: string }): Promise<void> => {
  const { tx, sessionId } = params
  await tx.query(
    tx.raw.sql`SELECT (pg_notify(${PG_WAKE_CHANNEL}, ${sessionId}) IS NULL)::text AS "sent"`
      .returnsRow({ sent: 'pg/text@1' })
      .build(),
  )
}

export const announceIn = async (params: { tx: Tx; change: SessionChange }): Promise<void> => {
  const { tx, change } = params
  const payload = JSON.stringify(change)
  await tx.query(
    tx.raw.sql`SELECT (pg_notify(${PG_CHANGE_CHANNEL}, ${payload}) IS NULL)::text AS "sent"`
      .returnsRow({ sent: 'pg/text@1' })
      .build(),
  )
}
