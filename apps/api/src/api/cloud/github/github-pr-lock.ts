import type { Tx } from '@dltech/atlas-db'

import { normalizedRepo } from './github-pr-identity'

const LOCK_NAMESPACE = 'gh-pr:'

export type PrScopeTx = Tx & { readonly prScope: unique symbol }

export function lockPrScope(args: { tx: Tx; repoFullName: string }): Promise<PrScopeTx> {
  const key = `${LOCK_NAMESPACE}${normalizedRepo(args.repoFullName)}`

  return args.tx
    .execute(
      args.tx.raw.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
        .affectedCount()
        .build(),
    )
    .then(() => args.tx as PrScopeTx)
}
