import { registerClient, type ClientInformation } from '@dltech/atlas-harness/mcp-oauth'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { unsealJson } from './mcp-oauth-seal'
import { sealedGrantSchema } from './mcp-oauth.types'
import type { SealedGrant, ServerGrantRow } from './mcp-oauth.types'

const reusableClientOf = (args: {
  row: ServerGrantRow
  cipher: SecretCipherService
  nowMs: number
  redirectUri: string
  tokenEndpoint: string
}): ClientInformation | undefined => {
  if (args.row.oauthSealed === null) return undefined
  let grant: SealedGrant
  try {
    grant = unsealJson({
      cipher: args.cipher,
      sealed: args.row.oauthSealed,
      schema: sealedGrantSchema,
    })
  } catch {
    return undefined
  }
  const secretExpiresAt = grant.clientInfo.clientSecretExpiresAt
  const secretExpired =
    secretExpiresAt !== undefined && secretExpiresAt > 0 && secretExpiresAt * 1000 <= args.nowMs
  const matches =
    grant.redirectUri === args.redirectUri && grant.tokenEndpoint === args.tokenEndpoint
  return matches && !secretExpired ? grant.clientInfo : undefined
}

export async function oauthClientFor(args: {
  row: ServerGrantRow
  cipher: SecretCipherService
  nowMs: number
  redirectUri: string
  tokenEndpoint: string
  registrationEndpoint?: string
  scope?: string
  fetch: Parameters<typeof registerClient>[0]['fetch']
}): Promise<ClientInformation | undefined> {
  const reusable = reusableClientOf(args)
  if (reusable !== undefined) return reusable
  if (args.registrationEndpoint === undefined) return undefined
  return registerClient({
    registrationEndpoint: args.registrationEndpoint,
    metadata: {
      redirectUris: [args.redirectUri],
      ...(args.scope === undefined ? {} : { scope: args.scope }),
    },
    fetch: args.fetch,
  })
}
