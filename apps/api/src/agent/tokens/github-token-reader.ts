import type { Db } from '@dltech/atlas-db'

import type { SecretCipher } from '../config/secret-cipher'

export class GithubTokenReader {
  constructor(private readonly args: { db: Db; cipher: SecretCipher }) {}

  async read({ userId }: { userId: string }): Promise<string | null> {
    const row = await this.args.db.orm.public.GithubConnection.first({ userId })
    if (row === null) return null
    return this.args.cipher.decrypt(row.sealedToken)
  }
}
