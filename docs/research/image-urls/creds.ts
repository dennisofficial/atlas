import { createPool } from '@dltech/atlas-db'

import { SecretCipher } from '../src/config/secret-cipher'

const DENNIS = 'M2E1MsEgUgE5Cos5xlNbALwTp9puu0uY'

export type HeldTokens = {
  connectionId: string
  accessToken: string
  expiresAt: string
  accountId?: string | undefined
}

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} unset`)
  return value
}

export const userId = DENNIS
export const cipher = new SecretCipher(required('SECRETS_ENCRYPTION_KEY'))
export const pool = createPool(required('DATABASE_URL'), {
  queryTimeoutMs: 10_000,
})

export async function activeConnectionId(provider: string): Promise<string> {
  const result = await pool.query(
    `SELECT a."sealedSecret" FROM "ActiveAccount" x JOIN "AgentAccount" a ON a.id = x."accountId" WHERE x."userId" = $1 AND x.provider = $2`,
    [DENNIS, provider],
  )
  const row = result.rows[0] as { sealedSecret: string } | undefined
  if (row === undefined) throw new Error(`no active ${provider} account`)
  const secret = JSON.parse(cipher.decrypt(row.sealedSecret)) as {
    authority?: { connectionId?: string }
  }
  const connectionId = secret.authority?.connectionId
  if (connectionId === undefined) throw new Error(`${provider} account has no connection`)
  return connectionId
}

export async function heldTokens(connectionId: string): Promise<HeldTokens> {
  const result = await pool.query(`SELECT "sealedTokens" FROM "OauthConnection" WHERE id = $1`, [
    connectionId,
  ])
  const row = result.rows[0] as { sealedTokens: string } | undefined
  if (row === undefined) throw new Error('connection missing')
  const tokens = JSON.parse(cipher.decrypt(row.sealedTokens)) as HeldTokens
  return { ...tokens, connectionId }
}

if (import.meta.main) {
  for (const provider of ['anthropic', 'openai']) {
    const id = await activeConnectionId(provider)
    const tokens = await heldTokens(id)
    console.log(
      provider,
      id,
      'expiresAt',
      tokens.expiresAt,
      'hasAccountId',
      tokens.accountId !== undefined,
    )
  }
  await pool.end()
}
