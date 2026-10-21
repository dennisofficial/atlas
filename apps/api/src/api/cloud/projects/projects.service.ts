import type { Project, ProjectRepo, ProjectWorkspace } from '@dltech/atlas-wire'
import { projectRepoSchema } from '@dltech/atlas-wire'
import { EShipBehavior } from '@dltech/atlas-wire/web'
import { Injectable, NotFoundException } from '@nestjs/common'
import { z } from 'zod'
import type { ProjectModel } from '../../../db'
import { db } from '../../../db'
import { GithubService } from '../github/github.service'
import type { SaveProjectDto } from './projects.dto'
import { assertProjectRules } from './projects.rules'

export const PROJECT_NOT_FOUND = 'project not found'

const repoListSchema = z.array(projectRepoSchema)

const reposOf = (row: ProjectModel): ProjectRepo[] => {
  const parsed = repoListSchema.safeParse(row.additionalRepos)
  return parsed.success ? parsed.data : []
}

const shipBehaviorOf = (stored: string): EShipBehavior =>
  Object.values(EShipBehavior).find((candidate) => candidate === stored) ??
  EShipBehavior.OpenPullRequest

function toProject(row: ProjectModel): Project {
  return {
    id: row.id,
    name: row.name,
    repo: row.repo,
    baseBranch: row.baseBranch,
    additionalRepos: reposOf(row),
    description: row.description,
    shipBehavior: shipBehaviorOf(row.shipBehavior),
    organizationId: row.organizationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function columnsOf(input: SaveProjectDto) {
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
    const rows = await db.project.findMany({
      where: { userId: args.userId },
      orderBy: { updatedAt: 'desc' },
    })
    return rows.map((row) => toProject(row))
  }

  async create(args: { userId: string; input: SaveProjectDto }): Promise<Project> {
    const row = await db.project.create({
      data: { userId: args.userId, ...columnsOf(args.input) },
    })
    return toProject(row)
  }

  async read(args: { userId: string; projectId: string }): Promise<Project> {
    return toProject(await this.owned(args))
  }

  async replace(args: {
    userId: string
    projectId: string
    input: SaveProjectDto
  }): Promise<Project> {
    const columns = columnsOf(args.input)
    await this.owned(args)
    const row = await db.project.update({ where: { id: args.projectId }, data: columns })
    return toProject(row)
  }

  async remove(args: { userId: string; projectId: string }): Promise<void> {
    const { count } = await db.project.deleteMany({
      where: { id: args.projectId, userId: args.userId },
    })
    if (count === 0) throw new NotFoundException(PROJECT_NOT_FOUND)
  }

  async workspace(args: { userId: string; projectId: string }): Promise<ProjectWorkspace> {
    const row = await this.owned(args)
    return {
      projectId: row.id,
      repo: row.repo,
      baseBranch: row.baseBranch,
      additionalRepos: reposOf(row),
      githubToken: (await this.github.findToken({ userId: args.userId })) ?? null,
    }
  }

  private async owned(args: { userId: string; projectId: string }): Promise<ProjectModel> {
    const row = await db.project.findFirst({
      where: { id: args.projectId, userId: args.userId },
    })
    if (row === null) throw new NotFoundException(PROJECT_NOT_FOUND)
    return row
  }
}
