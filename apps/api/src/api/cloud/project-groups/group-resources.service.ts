import { randomUUID } from 'node:crypto'
import { Injectable, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import type { FileMountSummary, SecretSummary } from '@dltech/atlas-wire/web'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { cleanupGroupGrant, resolveGroupGrantId } from '../access-grants/access-grant-membership'
import { assertEnvName, openSecretValue, sealSecretValue } from '../secrets/sealed-secret'
import { GroupsService } from './project-groups.service'

type Scope = { userId: string; groupId: string }

@Injectable()
export class GroupResourcesService {
  constructor(
    private readonly groups: GroupsService,
    private readonly cipher: SecretCipherService,
  ) {}

  async listSecrets(args: Scope): Promise<SecretSummary[]> {
    await this.groups.owned(args)
    const rows = await db.orm.public.GroupSecret.where({ groupId: args.groupId })
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => ({
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async revealSecret(args: Scope & { name: string }): Promise<string> {
    assertEnvName(args.name)
    await this.groups.owned(args)
    const row = await db.orm.public.GroupSecret.where({
      groupId: args.groupId,
      name: args.name,
    }).first()
    if (row === null) throw new NotFoundException('secret not found')
    return openSecretValue({ cipher: this.cipher, sealed: row.sealedValue })
  }

  async setSecret(
    args: Scope & { name: string; value: string; grantId?: string | undefined },
  ): Promise<void> {
    assertEnvName(args.name)
    await this.groups.owned(args)
    const sealedValue = sealSecretValue({ cipher: this.cipher, value: args.value })
    await db.transaction(async (tx) => {
      const { groupId } = args
      const existing = await tx.orm.public.GroupSecret.where({
        groupId,
        name: args.name,
      }).first()
      const grantId = await resolveGroupGrantId({
        tx,
        groupId,
        requestedGrantId: args.grantId,
        existingGrantId: existing === null ? null : existing.grantId,
        label: args.name,
      })
      await tx.orm.public.GroupSecret.upsert({
        conflictOn: { groupId, name: args.name },
        create: {
          id: `gsec_${randomUUID()}`,
          groupId,
          name: args.name,
          sealedValue,
          grantId,
        },
        update: { sealedValue, grantId },
      })
      if (existing !== null && existing.grantId !== grantId) {
        await cleanupGroupGrant({ tx, groupId, grantId: existing.grantId })
      }
    })
  }

  async removeSecret(args: Scope & { name: string }): Promise<void> {
    assertEnvName(args.name)
    await this.groups.owned(args)
    await db.transaction(async (tx) => {
      const { groupId } = args
      const existing = await tx.orm.public.GroupSecret.where({
        groupId,
        name: args.name,
      }).first()
      if (existing === null) return
      await tx.orm.public.GroupSecret.where({ groupId, name: args.name }).deleteAndCount()
      await cleanupGroupGrant({ tx, groupId, grantId: existing.grantId })
    })
  }

  async listFileMounts(args: Scope): Promise<FileMountSummary[]> {
    await this.groups.owned(args)
    const rows = await db.orm.public.GroupFileMount.where({ groupId: args.groupId })
      .orderBy((row) => row.path.asc())
      .all()
    return rows.map((row) => ({
      path: row.path,
      mode: row.mode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async revealFileMount(args: Scope & { path: string }): Promise<string> {
    await this.groups.owned(args)
    const row = await db.orm.public.GroupFileMount.where({
      groupId: args.groupId,
      path: args.path,
    }).first()
    if (row === null) throw new NotFoundException('file mount not found')
    return openSecretValue({ cipher: this.cipher, sealed: row.sealedContents })
  }

  async setFileMount(
    args: Scope & { path: string; contents: string; mode: number; grantId?: string | undefined },
  ): Promise<void> {
    await this.groups.owned(args)
    const sealedContents = sealSecretValue({ cipher: this.cipher, value: args.contents })
    await db.transaction(async (tx) => {
      const { groupId } = args
      const existing = await tx.orm.public.GroupFileMount.where({
        groupId,
        path: args.path,
      }).first()
      const grantId = await resolveGroupGrantId({
        tx,
        groupId,
        requestedGrantId: args.grantId,
        existingGrantId: existing === null ? null : existing.grantId,
        label: args.path,
      })
      await tx.orm.public.GroupFileMount.upsert({
        conflictOn: { groupId, path: args.path },
        create: {
          id: `gfm_${randomUUID()}`,
          groupId,
          path: args.path,
          sealedContents,
          mode: args.mode,
          grantId,
        },
        update: { sealedContents, mode: args.mode, grantId },
      })
      if (existing !== null && existing.grantId !== grantId) {
        await cleanupGroupGrant({ tx, groupId, grantId: existing.grantId })
      }
    })
  }

  async removeFileMount(args: Scope & { path: string }): Promise<void> {
    await this.groups.owned(args)
    await db.transaction(async (tx) => {
      const { groupId } = args
      const existing = await tx.orm.public.GroupFileMount.where({
        groupId,
        path: args.path,
      }).first()
      if (existing === null) return
      await tx.orm.public.GroupFileMount.where({ groupId, path: args.path }).deleteAndCount()
      await cleanupGroupGrant({ tx, groupId, grantId: existing.grantId })
    })
  }
}
