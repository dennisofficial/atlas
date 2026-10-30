import { randomUUID } from 'node:crypto'
import type { SecretSummary } from '@dltech/atlas-wire/web'
import { Injectable, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
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

  async set(args: { userId: string; name: string; value: string }): Promise<void> {
    assertEnvName(args.name)
    const sealedValue = this.cipher.encrypt(JSON.stringify(args.value))
    await db.orm.public.UserSecret.upsert({
      conflictOn: { userId: args.userId, name: args.name },
      create: {
        id: `sec_${randomUUID()}`,
        name: args.name,
        sealedValue,
        userId: args.userId,
      },
      update: { sealedValue },
    })
  }

  async remove(args: { userId: string; name: string }): Promise<void> {
    assertEnvName(args.name)
    await db.orm.public.UserSecret.where({ userId: args.userId, name: args.name }).deleteAndCount()
  }
}
