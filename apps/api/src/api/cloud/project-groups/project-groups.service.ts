import type { ProjectGroup, ProjectGroupSave } from '@dltech/atlas-wire'
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { db, isUniqueViolation, type Row } from '@dltech/atlas-db'
import { PROJECT_NOT_FOUND, ProjectsService } from '../projects/projects.service'

const GROUP_NOT_FOUND = 'project group not found'
const GROUP_NAME_TAKEN = 'a group with that name already exists'

const toProjectGroup = (args: {
  row: Row<'ProjectGroup'>
  projectIds: readonly string[]
}): ProjectGroup => ({
  id: args.row.id,
  name: args.row.name,
  projectIds: [...args.projectIds],
})

const withGroupNameConflict = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    throw new ConflictException(GROUP_NAME_TAKEN)
  }
}

@Injectable()
export class GroupsService {
  constructor(private readonly projects: ProjectsService) {}

  async owned(args: { userId: string; groupId: string }): Promise<Row<'ProjectGroup'>> {
    const row = await db.orm.public.ProjectGroup.first({ id: args.groupId })
    if (row === null || row.userId !== args.userId) throw new NotFoundException(GROUP_NOT_FOUND)
    return row
  }

  async list(args: { userId: string }): Promise<ProjectGroup[]> {
    const [groups, projects] = await Promise.all([
      db.orm.public.ProjectGroup.where({ userId: args.userId })
        .orderBy((row) => row.name.asc())
        .all(),
      db.orm.public.Project.where({ ownerUserId: args.userId }).all(),
    ])
    return groups.map((row) =>
      toProjectGroup({
        row,
        projectIds: projects
          .filter((project) => project.groupId === row.id)
          .map((project) => project.id),
      }),
    )
  }

  async read(args: { userId: string; groupId: string }): Promise<ProjectGroup> {
    const row = await this.owned(args)
    const projects = await db.orm.public.Project.where({
      ownerUserId: args.userId,
      groupId: row.id,
    }).all()
    return toProjectGroup({ row, projectIds: projects.map((project) => project.id) })
  }

  save(args: { userId: string; input: ProjectGroupSave }): Promise<ProjectGroup> {
    const name = args.input.name
    return withGroupNameConflict(async () => {
      if (args.input.id !== undefined) {
        await this.owned({ userId: args.userId, groupId: args.input.id })
        const row = await db.orm.public.ProjectGroup.where({ id: args.input.id }).update({ name })
        if (row === null) throw new NotFoundException(GROUP_NOT_FOUND)
        return this.read({ userId: args.userId, groupId: row.id })
      }
      const row = await db.orm.public.ProjectGroup.create({ userId: args.userId, name })
      return toProjectGroup({ row, projectIds: [] })
    })
  }

  async remove(args: { userId: string; id: string }): Promise<void> {
    await this.owned({ userId: args.userId, groupId: args.id })
    await db.orm.public.ProjectGroup.where({ id: args.id }).delete()
  }

  async assign(args: { userId: string; projectId: string; groupId: string | null }): Promise<void> {
    await this.projects.editable({ userId: args.userId, projectId: args.projectId })
    if (args.groupId !== null) await this.owned({ userId: args.userId, groupId: args.groupId })
    const row = await db.orm.public.Project.where({ id: args.projectId }).update({
      groupId: args.groupId,
    })
    if (row === null) throw new NotFoundException(PROJECT_NOT_FOUND)
  }
}
