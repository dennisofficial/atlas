import { randomUUID } from 'node:crypto'
import type { FileMountSummary } from '@dltech/atlas-wire/web'
import { Injectable, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import {
  cleanupPersonalGrant,
  resolvePersonalGrantId,
} from '../access-grants/access-grant-membership'
import { openSecretValue, sealSecretValue } from '../secrets/sealed-secret'

@Injectable()
export class UserFileMountsService {
  constructor(private readonly cipher: SecretCipherService) {}

  async list(args: { userId: string }): Promise<FileMountSummary[]> {
    const rows = await db.orm.public.UserFileMount.where({ userId: args.userId })
      .orderBy((row) => row.path.asc())
      .all()
    return rows.map((row) => ({
      path: row.path,
      mode: row.mode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async reveal(args: { userId: string; path: string }): Promise<string> {
    const row = await db.orm.public.UserFileMount.where({
      userId: args.userId,
      path: args.path,
    }).first()
    if (row === null) throw new NotFoundException('file mount not found')
    return openSecretValue({ cipher: this.cipher, sealed: row.sealedContents })
  }

  async set(args: {
    userId: string
    path: string
    contents: string
    mode: number
    grantId?: string | undefined
  }): Promise<void> {
    const sealedContents = sealSecretValue({ cipher: this.cipher, value: args.contents })
    await db.transaction(async (tx) => {
      const existing = await tx.orm.public.UserFileMount.where({
        userId: args.userId,
        path: args.path,
      }).first()
      const grantId = await resolvePersonalGrantId({
        tx,
        userId: args.userId,
        requestedGrantId: args.grantId,
        existingGrantId: existing === null ? null : existing.grantId,
        label: args.path,
      })
      await tx.orm.public.UserFileMount.upsert({
        conflictOn: { userId: args.userId, path: args.path },
        create: {
          id: `ufm_${randomUUID()}`,
          userId: args.userId,
          path: args.path,
          sealedContents,
          mode: args.mode,
          grantId,
        },
        update: { sealedContents, mode: args.mode, grantId },
      })
      if (existing !== null && existing.grantId !== grantId) {
        await cleanupPersonalGrant({ tx, userId: args.userId, grantId: existing.grantId })
      }
    })
  }

  async remove(args: { userId: string; path: string }): Promise<void> {
    await db.transaction(async (tx) => {
      const existing = await tx.orm.public.UserFileMount.where({
        userId: args.userId,
        path: args.path,
      }).first()
      if (existing === null) return
      await tx.orm.public.UserFileMount.where({
        userId: args.userId,
        path: args.path,
      }).deleteAndCount()
      await cleanupPersonalGrant({ tx, userId: args.userId, grantId: existing.grantId })
    })
  }
}
