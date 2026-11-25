import { randomUUID } from 'node:crypto'
import {
  EAccessMemberKind,
  type AccessGrant,
  type AccessGrantMove,
  type AccessGrantSave,
} from '@dltech/atlas-wire'
import { Injectable, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { GroupsService } from '../project-groups/project-groups.service'
import {
  assertGroupGrant,
  cleanupGroupGrant,
  withGrantNameConflict,
} from './access-grant-membership'

const GRANT_NOT_FOUND = 'access grant not found'
const MEMBER_NOT_FOUND = 'access grant member not found'

@Injectable()
export class GroupAccessGrantsService {
  constructor(private readonly groups: GroupsService) {}

  async list(args: { userId: string; groupId: string }): Promise<AccessGrant[]> {
    const { groupId } = args
    await this.groups.owned({ userId: args.userId, groupId })
    const [rows, secrets, mounts] = await Promise.all([
      db.orm.public.GroupAccessGrant.where({ groupId })
        .orderBy((row) => row.name.asc())
        .all(),
      db.orm.public.GroupSecret.where({ groupId }).all(),
      db.orm.public.GroupFileMount.where({ groupId }).all(),
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

  async save(args: {
    userId: string
    groupId: string
    input: AccessGrantSave
  }): Promise<{ id: string }> {
    const { groupId } = args
    await this.groups.owned({ userId: args.userId, groupId })
    const columns = { name: args.input.name, instruction: args.input.instruction }
    return withGrantNameConflict(async () => {
      if (args.input.id !== undefined) {
        const row = await db.orm.public.GroupAccessGrant.where({
          id: args.input.id,
          groupId,
        }).update(columns)
        if (row === null) throw new NotFoundException(GRANT_NOT_FOUND)
        return { id: row.id }
      }
      const id = `gag_${randomUUID()}`
      await db.orm.public.GroupAccessGrant.create({ id, groupId, ...columns })
      return { id }
    })
  }

  async remove(args: { userId: string; groupId: string; id: string }): Promise<void> {
    await this.groups.owned({ userId: args.userId, groupId: args.groupId })
    const removed = await db.orm.public.GroupAccessGrant.where({
      id: args.id,
      groupId: args.groupId,
    }).deleteAndCount()
    if (removed === 0) throw new NotFoundException(GRANT_NOT_FOUND)
  }

  async moveMember(args: {
    userId: string
    groupId: string
    input: AccessGrantMove
  }): Promise<void> {
    const { groupId } = args
    await this.groups.owned({ userId: args.userId, groupId })
    const { member, grantId } = args.input
    await db.transaction(async (tx) => {
      await assertGroupGrant({ tx, groupId, grantId })
      if (member.kind === EAccessMemberKind.Secret) {
        const secret = await tx.orm.public.GroupSecret.where({
          groupId,
          name: member.name,
        }).first()
        if (secret === null) throw new NotFoundException(MEMBER_NOT_FOUND)
        if (secret.grantId === grantId) return
        await tx.orm.public.GroupSecret.where({ groupId, name: member.name }).update({ grantId })
        await cleanupGroupGrant({ tx, groupId, grantId: secret.grantId })
        return
      }
      const mount = await tx.orm.public.GroupFileMount.where({ groupId, path: member.path }).first()
      if (mount === null) throw new NotFoundException(MEMBER_NOT_FOUND)
      if (mount.grantId === grantId) return
      await tx.orm.public.GroupFileMount.where({ groupId, path: member.path }).update({ grantId })
      await cleanupGroupGrant({ tx, groupId, grantId: mount.grantId })
    })
  }
}
