import { EAuthProvider } from '@dltech/atlas-core'
import {
  parsedAccountsOf,
  providerCredentialOf,
  type ActiveAccountRowLike,
  type SealedAccountRowLike,
} from '@dltech/atlas-credentials'

import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

export type GatewayAccountRows = {
  accounts(userId: string): Promise<readonly SealedAccountRowLike[]>
  active(userId: string): Promise<readonly ActiveAccountRowLike[]>
}

const apiKeyOf = (args: {
  accounts: readonly SealedAccountRowLike[]
  active: readonly ActiveAccountRowLike[]
  cipher: SecretCipher
}): string | undefined => {
  try {
    const credential = providerCredentialOf({
      provider: EAuthProvider.Gateway,
      parsed: parsedAccountsOf(args.accounts),
      activeAccounts: args.active,
      unseal: (sealed) => args.cipher.decrypt(sealed),
    })
    return credential?.kind === 'api-key' ? credential.apiKey : undefined
  } catch {
    return undefined
  }
}

export const gatewayKeyOf = async (args: {
  rows: GatewayAccountRows
  cipher: SecretCipher
  userId: string
}): Promise<string | undefined> => {
  const [accounts, active] = await Promise.all([
    args.rows.accounts(args.userId),
    args.rows.active(args.userId),
  ])

  return apiKeyOf({ accounts, active, cipher: args.cipher })
}
