import { randomUUID } from 'node:crypto'
import {
  EAccessMemberKind,
  type AccessGrant,
  type AccessGrantMove,
  type AccessGrantSave,
} from '@dltech/atlas-wire'
import { Injectable, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import {
  assertPersonalGrant,
  cleanupPersonalGrant,
  withGrantNameConflict,
} from './access-grant-membership'

const GRANT_NOT_FOUND = 'access grant not found'
const MEMBER_NOT_FOUND = 'access grant member not found'

@Injectable()
export class PersonalAccessGrantsService {
  async list(userId: string): Promise<AccessGrant[]> {
    const [rows, secrets, mounts] = await Promise.all([
      db.orm.public.UserAccessGrant.where({ userId })
        .orderBy((row) => row.name.asc())
        .all(),
      db.orm.public.UserSecret.where({ userId }).all(),
      db.orm.public.UserFileMount.where({ userId }).all(),
    ])
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      instruction: row.instruction,
      secrets: secrets
        .filter((secret) => secret.grantId === row.id)
        .map((secret) => ({ name: secret.name, updatedAt: secret.updatedAt.toISOString() }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      files: mounts
        .filter((mount) => mount.grantId === row.id)
        .map((mount) => ({
          path: mount.path,
          mode: mount.mode,
          updatedAt: mount.updatedAt.toISOString(),
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async save(args: { userId: string; input: AccessGrantSave }): Promise<{ id: string }> {
    const columns = { name: args.input.name, instruction: args.input.instruction }
    return withGrantNameConflict(async () => {
      if (args.input.id !== undefined) {
        const row = await db.orm.public.UserAccessGrant.where({
          id: args.input.id,
          userId: args.userId,
        }).update(columns)
        if (row === null) throw new NotFoundException(GRANT_NOT_FOUND)
        return { id: row.id }
      }
      const id = `uag_${randomUUID()}`
      await db.orm.public.UserAccessGrant.create({ id, userId: args.userId, ...columns })
      return { id }
    })
  }

  async remove(args: { userId: string; id: string }): Promise<void> {
    const removed = await db.orm.public.UserAccessGrant.where({
      id: args.id,
      userId: args.userId,
    }).deleteAndCount()
    if (removed === 0) throw new NotFoundException(GRANT_NOT_FOUND)
  }

  async moveMember(args: { userId: string; input: AccessGrantMove }): Promise<void> {
    const { member, grantId } = args.input
    await db.transaction(async (tx) => {
      await assertPersonalGrant({ tx, userId: args.userId, grantId })
      if (member.kind === EAccessMemberKind.Secret) {
        const secret = await tx.orm.public.UserSecret.where({
          userId: args.userId,
          name: member.name,
        }).first()
        if (secret === null) throw new NotFoundException(MEMBER_NOT_FOUND)
        if (secret.grantId === grantId) return
        await tx.orm.public.UserSecret.where({
          userId: args.userId,
          name: member.name,
        }).update({ grantId })
        await cleanupPersonalGrant({ tx, userId: args.userId, grantId: secret.grantId })
        return
      }
      const mount = await tx.orm.public.UserFileMount.where({
        userId: args.userId,
        path: member.path,
      }).first()
      if (mount === null) throw new NotFoundException(MEMBER_NOT_FOUND)
      if (mount.grantId === grantId) return
      await tx.orm.public.UserFileMount.where({
        userId: args.userId,
        path: member.path,
      }).update({ grantId })
      await cleanupPersonalGrant({ tx, userId: args.userId, grantId: mount.grantId })
    })
  }
}
