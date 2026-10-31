import type { Project, ProjectSave, ProjectWorkspace } from '@dltech/atlas-wire'
import { reposOf, toProject } from '../../platform/sessions/live-project'
import { Injectable, NotFoundException } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { GithubService } from '../github/github.service'
import { assertProjectRules } from './projects.rules'

export const PROJECT_NOT_FOUND = 'project not found'

function columnsOf(input: ProjectSave) {
  const additionalRepos = input.additionalRepos.map((entry) =>
    entry.branch ? { repo: entry.repo, branch: entry.branch } : { repo: entry.repo },
  )
  assertProjectRules({ repo: input.repo, additionalRepos })
  return {
    name: input.name,
    repo: input.repo,
    baseBranch: input.baseBranch,
    additionalRepos,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.shipBehavior === undefined ? {} : { shipBehavior: input.shipBehavior }),
  }
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly github: GithubService,
    private readonly signals: ThreadSignalsService,
  ) {}

  async list(args: { userId: string }): Promise<Project[]> {
    const rows = await db.orm.public.Project.where({ ownerUserId: args.userId })
      .orderBy((project) => project.createdAt.asc())
      .all()
    return rows.map((row) => toProject(row))
  }

  async create(args: { userId: string; input: ProjectSave }): Promise<Project> {
    const row = await db.orm.public.Project.create({
      ...columnsOf(args.input),
      ownerUserId: args.userId,
      createdById: args.userId,
    })
    const project = toProject(row)
    await this.projectChanged({ userId: args.userId, project })
    return project
  }

  async read(args: { userId: string; projectId: string }): Promise<Project> {
    return toProject(await this.editable(args))
  }

  async replace(args: { userId: string; projectId: string; input: ProjectSave }): Promise<Project> {
    const columns = columnsOf(args.input)
    await this.editable(args)
    const row = await db.orm.public.Project.where({ id: args.projectId }).update(columns)
    if (row === null) throw new NotFoundException(PROJECT_NOT_FOUND)
    const project = toProject(row)
    await this.projectChanged({ userId: args.userId, project })
    return project
  }

  async remove(args: { userId: string; projectId: string }): Promise<void> {
    await this.editable(args)
    await db.orm.public.Project.where({ id: args.projectId }).delete()
    await this.signals.publish({ userId: args.userId, projectId: args.projectId, removed: true })
  }

  private async projectChanged(args: { userId: string; project: Project }): Promise<void> {
    await this.signals.publish({ userId: args.userId, project: args.project })
  }

  async workspace(args: { userId: string; projectId: string }): Promise<ProjectWorkspace> {
    const row = await this.editable(args)
    return {
      projectId: row.id,
      repo: row.repo,
      baseBranch: row.baseBranch,
      additionalRepos: reposOf(row),
      githubToken: (await this.github.findToken({ userId: args.userId })) ?? null,
      setupScript: row.setupScript,
    }
  }

  async editable(args: { userId: string; projectId: string }): Promise<Row<'Project'>> {
    const row = await db.orm.public.Project.first({ id: args.projectId })
    if (row === null || row.ownerUserId !== args.userId)
      throw new NotFoundException(PROJECT_NOT_FOUND)
    return row
  }
}
