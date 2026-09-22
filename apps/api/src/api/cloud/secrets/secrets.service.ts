import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable } from '@nestjs/common'
import type { SecretEntryModel } from '../../../db'
import { db } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
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
    const rows = await db.secretEntry.findMany({
      where: { userId: args.userId },
      orderBy: { name: 'asc' },
    })
    return rows.map((row) => this.toSecretDto(row))
  }

  async listNamed(args: { userId: string; names: string[] }): Promise<SecretDto[]> {
    for (const name of args.names) assertValidName(name)
    const rows = await db.secretEntry.findMany({
      where: { userId: args.userId, name: { in: args.names } },
      orderBy: { name: 'asc' },
    })
    return rows.map((row) => this.toSecretDto(row))
  }

  async set(args: { userId: string; name: string; value: string }): Promise<void> {
    assertValidName(args.name)
    const sealedValue = this.cipher.encrypt(JSON.stringify(args.value))
    await db.secretEntry.upsert({
      where: { userId_name: { userId: args.userId, name: args.name } },
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
    await db.secretEntry.deleteMany({
      where: { userId: args.userId, name: args.name },
    })
  }

  private toSecretDto(row: SecretEntryModel): SecretDto {
    return {
      name: row.name,
      value: JSON.parse(this.cipher.decrypt(row.sealedValue)) as string,
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
