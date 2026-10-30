import { randomUUID } from 'node:crypto'
import {
  ENV_NAME_PATTERN,
  isHarnessLocalOnlyName,
  type PersonalSecret,
} from '@dltech/atlas-wire/web'
import { BadRequestException, Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openSecretValue, sealSecretValue } from '../secrets/sealed-secret'

const MAX_NAME_LENGTH = 200

function assertHarnessName(name: string): void {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new BadRequestException(
      `a harness secret name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`,
    )
  }
  if (ENV_NAME_PATTERN.test(name)) {
    throw new BadRequestException('env vars belong in secrets')
  }
  if (isHarnessLocalOnlyName(name)) {
    throw new BadRequestException('this secret stays on the machine that created it')
  }
}

@Injectable()
export class HarnessSecretsService {
  constructor(private readonly cipher: SecretCipherService) {}

  async list(args: { userId: string }): Promise<PersonalSecret[]> {
    const rows = await db.orm.public.UserHarnessSecret.where({ userId: args.userId })
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => ({
      name: row.name,
      value: openSecretValue({ cipher: this.cipher, sealed: row.sealedValue }),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async listNames(args: { userId: string }): Promise<string[]> {
    const rows = await db.orm.public.UserHarnessSecret.where({ userId: args.userId })
      .select('name')
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => row.name)
  }

  async set(args: { userId: string; name: string; value: string }): Promise<void> {
    assertHarnessName(args.name)
    const sealedValue = sealSecretValue({ cipher: this.cipher, value: args.value })
    await db.orm.public.UserHarnessSecret.upsert({
      conflictOn: { userId: args.userId, name: args.name },
      create: {
        id: `hsec_${randomUUID()}`,
        name: args.name,
        sealedValue,
        userId: args.userId,
      },
      update: { sealedValue },
    })
  }

  async remove(args: { userId: string; name: string }): Promise<void> {
    await db.orm.public.UserHarnessSecret.where({
      userId: args.userId,
      name: args.name,
    }).deleteAndCount()
  }
}
