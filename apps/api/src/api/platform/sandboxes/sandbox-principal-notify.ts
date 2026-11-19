import { sharedPool } from '@dltech/atlas-db'

export const SANDBOX_PRINCIPAL_REVOKED_CHANNEL = 'sandbox_principal_revoked'

/** A payload naming every session: the writer could not narrow the revocation to one. */
export const REVOKE_ALL = '*'

/**
 * Tells every API instance that the cached principal of `sessionId` is gone. Call it after the
 * revoking write commits: a listener that re-reads before the commit caches the row it was told
 * to forget. Payload `*` clears the whole cache, for writes that rotate an unknown set of tokens.
 */
export async function notifyPrincipalRevoked(sessionId: string): Promise<void> {
  await sharedPool().query('SELECT pg_notify($1, $2)', [
    SANDBOX_PRINCIPAL_REVOKED_CHANNEL,
    sessionId,
  ])
}
