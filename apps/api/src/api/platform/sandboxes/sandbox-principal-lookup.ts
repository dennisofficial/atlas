import { sharedPool } from '@dltech/atlas-db'
import type { SandboxPrincipal } from './rows'

export type ResolvedToken = {
  sandbox: (SandboxPrincipal & { sessionId: string }) | null
  pod: { threadId: string; userId: string } | null
}

export type TokenLookup = (tokenHash: string) => Promise<ResolvedToken>

type PrincipalRow = {
  kind: 'sandbox' | 'pod'
  id: string | null
  userId: string
  threadId: string
  sessionId: string | null
}

/**
 * One round trip resolves a bearer to whatever it may be: the sandbox row joined to the session
 * that owns its thread, or the local-pod lease. Both lookups ride their unique index on
 * `tokenHash`. A retired sandbox and a soft-deleted session resolve to nothing, which is what
 * makes retirement revocation rather than bookkeeping.
 */
const PRINCIPAL_SQL = `
SELECT 'sandbox'::text AS "kind", sandbox."id", sandbox."userId", sandbox."sessionId",
       session."mainThreadId" AS "threadId"
  FROM "CloudSandbox" sandbox
  JOIN "Session" session ON session."id" = sandbox."sessionId"
 WHERE sandbox."tokenHash" = $1
   AND sandbox."retiredAt" IS NULL
   AND session."deletedAt" IS NULL
   AND session."mainThreadId" IS NOT NULL
UNION ALL
SELECT 'pod', NULL, lease."userId", NULL, lease."threadId"
  FROM "LocalPodLease" lease
 WHERE lease."tokenHash" = $1
`

export const lookupTokenPrincipal: TokenLookup = async (tokenHash) => {
  const { rows } = await sharedPool().query<PrincipalRow>(PRINCIPAL_SQL, [tokenHash])
  const sandbox = rows.find((row) => row.kind === 'sandbox')
  const pod = rows.find((row) => row.kind === 'pod')
  return {
    sandbox:
      sandbox === undefined
        ? null
        : {
            id: sandbox.id ?? '',
            userId: sandbox.userId,
            threadId: sandbox.threadId,
            sessionId: sandbox.sessionId ?? '',
          },
    pod: pod === undefined ? null : { threadId: pod.threadId, userId: pod.userId },
  }
}
