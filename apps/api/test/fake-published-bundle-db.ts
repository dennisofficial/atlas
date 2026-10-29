import { db, type Pool } from '@dltech/atlas-db'

export const bundlesOf = () =>
  db.orm.public.PublishedBundle.where((row) => row.id.neq(''))
    .orderBy((row) => row.version.asc())
    .all()

export async function waitForBlockedInsert(pool: Pool): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const waiting = await pool.query(
      "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE 'INSERT%PublishedBundle%'",
    )
    if ((waiting.rowCount ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('the bundle insert never blocked on the rival row')
}

export async function withRivalBundle<T>(args: {
  pool: Pool
  sha: string
  run: (signalCommit: () => Promise<void>) => Promise<T>
}): Promise<T> {
  const rival = await args.pool.connect()
  let open = true
  const close = async (command: 'COMMIT' | 'ROLLBACK') => {
    if (!open) return
    open = false
    await rival.query(command).catch(() => undefined)
    rival.release()
  }
  try {
    await rival.query('BEGIN')
    await rival.query(
      `INSERT INTO "PublishedBundle" (id, "userId", version, pathname, "blobUrl", sha256, "sizeBytes", manifest) VALUES ('rival', 'user-a', 1, 'bundles/user-a/rival.tar.gz', 'https://blob.test/rival', $1, 1, '{}')`,
      [args.sha],
    )
    return await args.run(() => close('COMMIT'))
  } finally {
    await close('ROLLBACK')
  }
}
