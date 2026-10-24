import type { UserVercelCredential, UserVercelCredentialUpsert } from '@dltech/atlas-wire/web'
import { BadRequestException, Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { sealSecretValue } from '../secrets/sealed-secret'

const UNCONFIGURED: UserVercelCredential = {
  configured: false,
  teamId: null,
  vercelProjectId: null,
  updatedAt: null,
}

@Injectable()
export class UserVercelService {
  constructor(private readonly cipher: SecretCipherService) {}

  async read(args: { userId: string }): Promise<UserVercelCredential> {
    const row = await db.orm.public.UserVercelCredential.first({ userId: args.userId })
    if (row === null) return UNCONFIGURED
    return {
      configured: true,
      teamId: row.teamId,
      vercelProjectId: row.vercelProjectId,
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  async remove(args: { userId: string }): Promise<void> {
    await db.orm.public.UserVercelCredential.where({ userId: args.userId }).deleteAndCount()
  }

  async write(args: { userId: string; input: UserVercelCredentialUpsert }): Promise<void> {
    const { userId, input } = args
    if (input.token === undefined) {
      const count = await db.orm.public.UserVercelCredential.where({ userId }).updateAndCount({
        teamId: input.teamId,
        vercelProjectId: input.vercelProjectId,
      })
      if (count === 0) throw new BadRequestException('a token is required the first time')
      return
    }
    const sealedToken = sealSecretValue({ cipher: this.cipher, value: input.token })
    await db.orm.public.UserVercelCredential.upsert({
      conflictOn: { userId },
      create: {
        userId,
        sealedToken,
        teamId: input.teamId,
        vercelProjectId: input.vercelProjectId,
      },
      update: { sealedToken, teamId: input.teamId, vercelProjectId: input.vercelProjectId },
    })
  }
}
