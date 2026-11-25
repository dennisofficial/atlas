import { randomUUID } from 'node:crypto'
import {
  EAccessScope,
  type AccessGrant,
  type AccessGrantSave,
  type AccessScope,
} from '@dltech/atlas-wire'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { and, db, isUniqueViolation, type Tx } from '@dltech/atlas-db'
import { ProjectsService } from '../projects/projects.service'

const GRANT_NOT_FOUND = 'access grant not found'
const GRANT_NAME_TAKEN = 'a grant with that name already exists'

type Member = { name: string; grantId: string | null }

const namesIn = (args: { members: Member[]; grantId: string }): string[] =>
  args.members
    .filter((member) => member.grantId === args.grantId)
    .map((member) => member.name)
    .sort()

const assertAllHeld = (args: { listed: string[]; held: string[]; missing: string }): void => {
  const held = new Set(args.held)
  const unknown = args.listed.find((name) => !held.has(name))
  if (unknown !== undefined) throw new BadRequestException(`${args.missing} ${unknown}`)
}

@Injectable()
export class AccessGrantsService {
  constructor(private readonly projects: ProjectsService) {}

  async list(args: { userId: string; scope: AccessScope }): Promise<AccessGrant[]> {
    if (args.scope.kind === EAccessScope.Personal) return this.listPersonal(args.userId)
    return this.listProject({ userId: args.userId, projectId: args.scope.projectId })
  }

  async save(args: { userId: string; input: AccessGrantSave }): Promise<{ id: string }> {
    if (args.input.scope.kind === EAccessScope.Personal) return this.savePersonal(args)
    return this.saveProject({
      userId: args.userId,
      input: args.input,
      projectId: args.input.scope.projectId,
    })
  }

  async remove(args: { userId: string; scope: AccessScope; id: string }): Promise<void> {
    if (args.scope.kind === EAccessScope.Personal) {
      const removed = await db.orm.public.UserAccessGrant.where({
        id: args.id,
        userId: args.userId,
      }).deleteAndCount()
      if (removed === 0) throw new NotFoundException(GRANT_NOT_FOUND)
      return
    }
    const { projectId } = args.scope
    await this.projects.read({ userId: args.userId, projectId })
    const removed = await db.orm.public.ProjectAccessGrant.where({
      id: args.id,
      projectId,
    }).deleteAndCount()
    if (removed === 0) throw new NotFoundException(GRANT_NOT_FOUND)
  }

  private async listPersonal(userId: string): Promise<AccessGrant[]> {
    const [rows, secrets] = await Promise.all([
      db.orm.public.UserAccessGrant.where({ userId })
        .orderBy((row) => row.name.asc())
        .all(),
      db.orm.public.UserSecret.where({ userId }).all(),
    ])
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      instruction: row.instruction,
      secretNames: namesIn({ members: secrets, grantId: row.id }),
      filePaths: [],
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  private async listProject(args: { userId: string; projectId: string }): Promise<AccessGrant[]> {
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
      secretNames: namesIn({ members: secrets, grantId: row.id }),
      filePaths: namesIn({
        members: mounts.map((mount) => ({ name: mount.path, grantId: mount.grantId })),
        grantId: row.id,
      }),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  private async savePersonal(args: {
    userId: string
    input: AccessGrantSave
  }): Promise<{ id: string }> {
    if (args.input.filePaths.length > 0) {
      throw new BadRequestException('a personal grant holds no file mounts')
    }
    return this.withNameConflict(
      db.transaction(async (tx) => {
        const id = await this.writePersonalGrant({ tx, userId: args.userId, input: args.input })
        await tx.orm.public.UserSecret.where({ userId: args.userId, grantId: id }).updateAll({
          grantId: null,
        })
        if (args.input.secretNames.length > 0) {
          await tx.orm.public.UserSecret.where((row) =>
            and(row.userId.eq(args.userId), row.name.in(args.input.secretNames)),
          ).updateAll({ grantId: id })
        }
        const held = await tx.orm.public.UserSecret.where({
          userId: args.userId,
          grantId: id,
        }).all()
        assertAllHeld({
          listed: args.input.secretNames,
          held: held.map((secret) => secret.name),
          missing: 'no secret named',
        })
        return { id }
      }),
    )
  }

  private async saveProject(args: {
    userId: string
    input: AccessGrantSave
    projectId: string
  }): Promise<{ id: string }> {
    const { projectId } = args
    await this.projects.read({ userId: args.userId, projectId })
    return this.withNameConflict(
      db.transaction(async (tx) => {
        const id = await this.writeProjectGrant({ tx, projectId, input: args.input })
        await tx.orm.public.ProjectSecret.where({ projectId, grantId: id }).updateAll({
          grantId: null,
        })
        await tx.orm.public.ProjectFileMount.where({ projectId, grantId: id }).updateAll({
          grantId: null,
        })
        if (args.input.secretNames.length > 0) {
          await tx.orm.public.ProjectSecret.where((row) =>
            and(row.projectId.eq(projectId), row.name.in(args.input.secretNames)),
          ).updateAll({ grantId: id })
        }
        if (args.input.filePaths.length > 0) {
          await tx.orm.public.ProjectFileMount.where((row) =>
            and(row.projectId.eq(projectId), row.path.in(args.input.filePaths)),
          ).updateAll({ grantId: id })
        }
        const [secrets, mounts] = await Promise.all([
          tx.orm.public.ProjectSecret.where({ projectId, grantId: id }).all(),
          tx.orm.public.ProjectFileMount.where({ projectId, grantId: id }).all(),
        ])
        assertAllHeld({
          listed: args.input.secretNames,
          held: secrets.map((secret) => secret.name),
          missing: 'no secret named',
        })
        assertAllHeld({
          listed: args.input.filePaths,
          held: mounts.map((mount) => mount.path),
          missing: 'no file mount at',
        })
        return { id }
      }),
    )
  }

  private async writePersonalGrant(args: {
    tx: Tx
    userId: string
    input: AccessGrantSave
  }): Promise<string> {
    const columns = { name: args.input.name, instruction: args.input.instruction }
    if (args.input.id !== undefined) {
      const row = await args.tx.orm.public.UserAccessGrant.where({
        id: args.input.id,
        userId: args.userId,
      }).update(columns)
      if (row === null) throw new NotFoundException(GRANT_NOT_FOUND)
      return row.id
    }
    const id = `uag_${randomUUID()}`
    await args.tx.orm.public.UserAccessGrant.create({ id, userId: args.userId, ...columns })
    return id
  }

  private async writeProjectGrant(args: {
    tx: Tx
    projectId: string
    input: AccessGrantSave
  }): Promise<string> {
    const columns = { name: args.input.name, instruction: args.input.instruction }
    if (args.input.id !== undefined) {
      const row = await args.tx.orm.public.ProjectAccessGrant.where({
        id: args.input.id,
        projectId: args.projectId,
      }).update(columns)
      if (row === null) throw new NotFoundException(GRANT_NOT_FOUND)
      return row.id
    }
    const id = `pag_${randomUUID()}`
    await args.tx.orm.public.ProjectAccessGrant.create({
      id,
      projectId: args.projectId,
      ...columns,
    })
    return id
  }

  private async withNameConflict<T>(run: Promise<T>): Promise<T> {
    try {
      return await run
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      throw new ConflictException(GRANT_NAME_TAKEN)
    }
  }
}
