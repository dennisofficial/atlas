import { randomUUID } from 'node:crypto'
import type { SecretSummary } from '@dltech/atlas-wire/web'
import { Injectable, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { resolvePersonalGrantId } from '../access-grants/access-grant-membership'
import { assertEnvName, openSecretValue } from './sealed-secret'

@Injectable()
export class SecretsService {
  constructor(private readonly cipher: SecretCipherService) {}

  async listNames(args: { userId: string }): Promise<string[]> {
    const rows = await db.orm.public.UserSecret.where({ userId: args.userId })
      .select('name')
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => row.name)
  }

  async listSummaries(args: { userId: string }): Promise<SecretSummary[]> {
    const rows = await db.orm.public.UserSecret.where({ userId: args.userId })
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => ({
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async reveal(args: { userId: string; name: string }): Promise<string> {
    assertEnvName(args.name)
    const row = await db.orm.public.UserSecret.where({
      userId: args.userId,
      name: args.name,
    }).first()
    if (row === null) throw new NotFoundException('secret not found')
    return openSecretValue({ cipher: this.cipher, sealed: row.sealedValue })
  }

  async set(args: {
    userId: string
    name: string
    value: string
    grantId?: string | undefined
  }): Promise<void> {
    assertEnvName(args.name)
    const sealedValue = this.cipher.encrypt(JSON.stringify(args.value))
    await db.transaction(async (tx) => {
      const existing = await tx.orm.public.UserSecret.where({
        userId: args.userId,
        name: args.name,
      }).first()
      const grantId = await resolvePersonalGrantId({
        tx,
        userId: args.userId,
        requestedGrantId: args.grantId,
        existingGrantId: existing === null ? null : existing.grantId,
        label: args.name,
      })
      await tx.orm.public.UserSecret.upsert({
        conflictOn: { userId: args.userId, name: args.name },
        create: {
          id: `sec_${randomUUID()}`,
          name: args.name,
          sealedValue,
          userId: args.userId,
          grantId,
        },
        update: { sealedValue, grantId },
      })
    })
  }

  async remove(args: { userId: string; name: string }): Promise<void> {
    assertEnvName(args.name)
    await db.orm.public.UserSecret.where({ userId: args.userId, name: args.name }).deleteAndCount()
  }
}
