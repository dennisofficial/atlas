import { randomUUID } from 'node:crypto'
import type { SecretDetail } from '@dltech/atlas-wire/web'
import type { ESecretKind } from '@dltech/atlas-wire/web'
import { BadRequestException, Injectable } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { kindOf, openSecretValue } from './sealed-secret'
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

  async listDetails(args: { userId: string }): Promise<SecretDetail[]> {
    const rows = await db.orm.public.UserSecret.where({ userId: args.userId })
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => ({
      name: row.name,
      kind: kindOf(row.kind),
      value: openSecretValue({ cipher: this.cipher, sealed: row.sealedValue }),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async set(args: {
    userId: string
    name: string
    value: string
    kind?: ESecretKind | undefined
  }): Promise<void> {
    assertValidName(args.name)
    const sealedValue = this.cipher.encrypt(JSON.stringify(args.value))
    await db.orm.public.UserSecret.upsert({
      conflictOn: { userId: args.userId, name: args.name },
      create: {
        id: `sec_${randomUUID()}`,
        name: args.name,
        sealedValue,
        userId: args.userId,
        ...(args.kind === undefined ? {} : { kind: args.kind }),
      },
      update: { sealedValue, ...(args.kind === undefined ? {} : { kind: args.kind }) },
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
