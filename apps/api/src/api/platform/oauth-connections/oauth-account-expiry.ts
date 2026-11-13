import { authorityOf, type AccountSecret } from '@dltech/atlas-core'

import type { OauthConnectionStore } from './oauth-connections.types'

type Decryptor = { decrypt(sealedSecret: string): string }

const connectionOf = (args: { sealedSecret: string; cipher: Decryptor }): string | undefined => {
  const secret = JSON.parse(args.cipher.decrypt(args.sealedSecret)) as AccountSecret
  return authorityOf(secret)?.connectionId
}

export const expireAccountsOf = async (args: {
  row: { id: string; userId: string }
  store: Pick<OauthConnectionStore, 'sealedSecretsOf' | 'markExpired'>
  cipher: Decryptor
}): Promise<void> => {
  const accounts = await args.store.sealedSecretsOf({ userId: args.row.userId })
  const ids = accounts
    .filter(
      (account) =>
        connectionOf({ sealedSecret: account.sealedSecret, cipher: args.cipher }) === args.row.id,
    )
    .map((account) => account.id)
  if (ids.length > 0) await args.store.markExpired({ ids })
}
