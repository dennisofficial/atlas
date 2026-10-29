import type { Project, ProjectRepo, ProjectSave, ProjectWorkspace } from '@dltech/atlas-wire'
import { projectRepoSchema } from '@dltech/atlas-wire'
import { EShipBehavior } from '@dltech/atlas-wire/web'
import { Injectable, NotFoundException } from '@nestjs/common'
import { z } from 'zod'
import { db, type Row } from '@dltech/atlas-db'
import { GithubService } from '../github/github.service'
import { assertProjectRules } from './projects.rules'

export const PROJECT_NOT_FOUND = 'project not found'

const repoListSchema = z.array(projectRepoSchema)

const reposOf = (row: Row<'Project'>): ProjectRepo[] => {
  const parsed = repoListSchema.safeParse(row.additionalRepos)
  return parsed.success ? parsed.data : []
}

const shipBehaviorOf = (stored: string): EShipBehavior =>
  Object.values(EShipBehavior).find((candidate) => candidate === stored) ??
  EShipBehavior.OpenPullRequest

function toProject(row: Row<'Project'>): Project {
  return {
    id: row.id,
    name: row.name,
    repo: row.repo,
    baseBranch: row.baseBranch,
    additionalRepos: reposOf(row),
    description: row.description,
    shipBehavior: shipBehaviorOf(row.shipBehavior),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

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
  constructor(private readonly github: GithubService) {}

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
    return toProject(row)
  }

  async read(args: { userId: string; projectId: string }): Promise<Project> {
    return toProject(await this.editable(args))
  }

  async replace(args: { userId: string; projectId: string; input: ProjectSave }): Promise<Project> {
    const columns = columnsOf(args.input)
    await this.editable(args)
    const row = await db.orm.public.Project.where({ id: args.projectId }).update(columns)
    if (row === null) throw new NotFoundException(PROJECT_NOT_FOUND)
    return toProject(row)
  }

  async remove(args: { userId: string; projectId: string }): Promise<void> {
    await this.editable(args)
    await db.orm.public.Project.where({ id: args.projectId }).delete()
  }

  async workspace(args: { userId: string; projectId: string }): Promise<ProjectWorkspace> {
    const row = await this.editable(args)
    return {
      projectId: row.id,
      repo: row.repo,
      baseBranch: row.baseBranch,
      additionalRepos: reposOf(row),
      githubToken: (await this.github.findToken({ userId: args.userId })) ?? null,
    }
  }

  async editable(args: { userId: string; projectId: string }): Promise<Row<'Project'>> {
    const row = await db.orm.public.Project.first({ id: args.projectId })
    if (row === null || row.ownerUserId !== args.userId)
      throw new NotFoundException(PROJECT_NOT_FOUND)
    return row
  }
}
