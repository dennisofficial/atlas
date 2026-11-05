import type { Pool } from '@dltech/atlas-db'

import { rawSessionToken } from './raw-session-token'
import type { StreamAuthPort } from './stream-auth'

type AuthSessionRow = { userId: string; expiresAt: Date }

export const createPgStreamAuth = (args: { pool: Pool; now?: () => number }): StreamAuthPort => {
  const now = args.now ?? Date.now
  return {
    resolve: async (bearer) => {
      const token = rawSessionToken(bearer)
      if (token === undefined) return undefined
      const result = await args.pool.query<AuthSessionRow>(
        'SELECT "userId", "expiresAt" FROM "public"."AuthSession" WHERE "token" = $1',
        [token],
      )
      const row = result.rows[0]
      if (row === undefined) return undefined
      const expiresAt = row.expiresAt.getTime()
      return expiresAt > now() ? { userId: row.userId, expiresAt } : undefined
    },
  }
}
