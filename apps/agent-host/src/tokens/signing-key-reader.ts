import type { Db } from '@dltech/atlas-db'

import type { SecretCipher } from '../config/secret-cipher'

export type SigningKey = {
  publicKey: string
  privateKey: string
  userName: string
  userEmail: string
}

export class SigningKeyReader {
  constructor(private readonly args: { db: Db; cipher: SecretCipher }) {}

  async read({ userId }: { userId: string }): Promise<SigningKey | null> {
    const row = await this.args.db.orm.public.SshSigningKey.first({ userId })
    if (row === null) return null
    return {
      publicKey: row.publicKey,
      privateKey: this.args.cipher.decrypt(row.sealedPrivateKey),
      userName: row.userName,
      userEmail: row.userEmail,
    }
  }
}
