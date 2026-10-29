import { randomUUID } from 'node:crypto'
import type { SecretSummary } from '@dltech/atlas-wire/web'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openSecretValue } from './sealed-secret'
import type { SecretDto } from './secrets.types'

const MAX_NAME_LENGTH = 200

function assertValidName(name: string): void {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new BadRequestException(
      `a secret name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`,
    )
  }
}

@Injectable()
export class SecretsService {
  constructor(private readonly cipher: SecretCipherService) {}

  async list(args: { userId: string }): Promise<SecretDto[]> {
    const rows = await db.orm.public.UserSecret.where({ userId: args.userId })
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => this.toSecretDto(row))
  }

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
    assertValidName(args.name)
    const row = await db.orm.public.UserSecret.where({
      userId: args.userId,
      name: args.name,
    }).first()
    if (row === null) throw new NotFoundException('secret not found')
    return openSecretValue({ cipher: this.cipher, sealed: row.sealedValue })
  }

  async set(args: { userId: string; name: string; value: string }): Promise<void> {
    assertValidName(args.name)
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
    assertValidName(args.name)
    await db.orm.public.UserSecret.where({ userId: args.userId, name: args.name }).deleteAndCount()
  }

  private toSecretDto(row: Row<'UserSecret'>): SecretDto {
    return {
      name: row.name,
      value: JSON.parse(this.cipher.decrypt(row.sealedValue)) as string,
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
