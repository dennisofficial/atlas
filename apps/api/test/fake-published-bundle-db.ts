import { db, type Pool } from '@dltech/atlas-db'

export const bundlesOf = () =>
  db.orm.public.PublishedBundle.where((row) => row.id.neq(''))
    .orderBy((row) => row.version.asc())
    .all()

export async function waitForBlockedInsert(pool: Pool): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const waiting = await pool.query(
      "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE 'INSERT%PublishedBundle%'",
    )
    if (waiting.rowCount === 1) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('the bundle insert never blocked on the rival row')
}
