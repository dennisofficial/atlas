import { randomUUID } from 'node:crypto'
import {
  EAccessMemberKind,
  type AccessGrant,
  type AccessGrantMove,
  type AccessGrantSave,
} from '@dltech/atlas-wire'
import { Injectable, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { ProjectsService } from '../projects/projects.service'
import { assertProjectGrant, withGrantNameConflict } from './access-grant-membership'

const GRANT_NOT_FOUND = 'access grant not found'
const MEMBER_NOT_FOUND = 'access grant member not found'

@Injectable()
export class ProjectAccessGrantsService {
  constructor(private readonly projects: ProjectsService) {}

  async list(args: { userId: string; projectId: string }): Promise<AccessGrant[]> {
    const { projectId } = args
    await this.projects.read({ userId: args.userId, projectId })
    const [rows, secrets, mounts] = await Promise.all([
      db.orm.public.ProjectAccessGrant.where({ projectId })
        .orderBy((row) => row.name.asc())
        .all(),
      db.orm.public.ProjectSecret.where({ projectId }).all(),
      db.orm.public.ProjectFileMount.where({ projectId }).all(),
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
    projectId: string
    input: AccessGrantSave
  }): Promise<{ id: string }> {
    const { projectId } = args
    await this.projects.read({ userId: args.userId, projectId })
    const columns = { name: args.input.name, instruction: args.input.instruction }
    return withGrantNameConflict(async () => {
      if (args.input.id !== undefined) {
        const row = await db.orm.public.ProjectAccessGrant.where({
          id: args.input.id,
          projectId,
        }).update(columns)
        if (row === null) throw new NotFoundException(GRANT_NOT_FOUND)
        return { id: row.id }
      }
      const id = `pag_${randomUUID()}`
      await db.orm.public.ProjectAccessGrant.create({ id, projectId, ...columns })
      return { id }
    })
  }

  async remove(args: { userId: string; projectId: string; id: string }): Promise<void> {
    await this.projects.read({ userId: args.userId, projectId: args.projectId })
    const removed = await db.orm.public.ProjectAccessGrant.where({
      id: args.id,
      projectId: args.projectId,
    }).deleteAndCount()
    if (removed === 0) throw new NotFoundException(GRANT_NOT_FOUND)
  }

  async moveMember(args: {
    userId: string
    projectId: string
    input: AccessGrantMove
  }): Promise<void> {
    const { projectId } = args
    await this.projects.read({ userId: args.userId, projectId })
    const { member, grantId } = args.input
    await db.transaction(async (tx) => {
      await assertProjectGrant({ tx, projectId, grantId })
      if (member.kind === EAccessMemberKind.Secret) {
        const secret = await tx.orm.public.ProjectSecret.where({
          projectId,
          name: member.name,
        }).first()
        if (secret === null) throw new NotFoundException(MEMBER_NOT_FOUND)
        if (secret.grantId === grantId) return
        await tx.orm.public.ProjectSecret.where({ projectId, name: member.name }).update({
          grantId,
        })
        return
      }
      const mount = await tx.orm.public.ProjectFileMount.where({
        projectId,
        path: member.path,
      }).first()
      if (mount === null) throw new NotFoundException(MEMBER_NOT_FOUND)
      if (mount.grantId === grantId) return
      await tx.orm.public.ProjectFileMount.where({ projectId, path: member.path }).update({
        grantId,
      })
    })
  }
}
