import { db } from '@dltech/atlas-db'
import type { Tx } from '@dltech/atlas-db'

export async function withArtifactLock<T>(args: {
  artifactId: string
  work: (tx: Tx) => Promise<T>
}): Promise<T> {
  return db.transaction(async (tx) => {
    const key = `artifact:${args.artifactId}`
    const statement = tx.raw.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`
      .affectedCount()
      .build()
    await tx.execute(statement)
    return args.work(tx)
  })
}
