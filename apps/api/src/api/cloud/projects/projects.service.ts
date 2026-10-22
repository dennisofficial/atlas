import type { Project, ProjectRepo, ProjectWorkspace } from '@dltech/atlas-wire'
import { projectRepoSchema } from '@dltech/atlas-wire'
import { EShipBehavior } from '@dltech/atlas-wire/web'
import { Injectable, NotFoundException } from '@nestjs/common'
import { z } from 'zod'
import { db, or, type Row } from '@dltech/atlas-db'
import { GithubService } from '../github/github.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access.service'
import type { SaveProjectDto } from './projects.dto'
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

function ownershipOf(args: { userId: string; organizationId: string | null | undefined }) {
  if (args.organizationId === undefined) return {}
  if (args.organizationId === null) return { organizationId: null, ownerUserId: args.userId }
  return { organizationId: args.organizationId, ownerUserId: null }
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly github: GithubService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async list(args: { userId: string }): Promise<Project[]> {
    const memberships = await db.orm.public.Member.select('organizationId').where({ userId: args.userId }).all()
    const organizationIds = memberships.map((member) => member.organizationId)
    const rows = await db.orm.public.Project.where((project) =>
      or(project.ownerUserId.eq(args.userId), project.organizationId.in(organizationIds)),
    )
      .orderBy((project) => project.updatedAt.desc())
      .all()
    return rows.map((row) => toProject(row))
  }

  async create(args: { userId: string; input: SaveProjectDto }): Promise<Project> {
    const columns = columnsOf(args.input)
    await this.assertMembership({ userId: args.userId, organizationId: args.input.organizationId })
    const organizationId = args.input.organizationId ?? null
    const row = await db.orm.public.Project.create({
      ...columns,
      organizationId,
      ownerUserId: organizationId === null ? args.userId : null,
      createdById: args.userId,
    })
    return toProject(row)
  }

  async read(args: { userId: string; projectId: string }): Promise<Project> {
    return toProject(await this.editable(args))
  }

  async replace(args: {
    userId: string
    projectId: string
    input: SaveProjectDto
  }): Promise<Project> {
    const columns = columnsOf(args.input)
    await this.editable(args)
    await this.assertMembership({ userId: args.userId, organizationId: args.input.organizationId })
    const row = await db.orm.public.Project.where({ id: args.projectId }).update({
      ...columns,
      ...ownershipOf({ userId: args.userId, organizationId: args.input.organizationId }),
    })
    if (row === null) throw new NotFoundException(PROJECT_NOT_FOUND)
    return toProject(row)
  }

  async remove(args: { userId: string; projectId: string }): Promise<void> {
    const row = await this.editable(args)
    if (row.organizationId !== null) {
      await this.access.require({ userId: args.userId, organizationId: row.organizationId, write: true })
    }
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

  private async assertMembership(args: {
    userId: string
    organizationId: string | null | undefined
  }): Promise<void> {
    if (args.organizationId === undefined || args.organizationId === null) return
    await this.access.require({ userId: args.userId, organizationId: args.organizationId, write: false })
  }

  async editable(args: { userId: string; projectId: string }): Promise<Row<'Project'>> {
    const row = await db.orm.public.Project.first({ id: args.projectId })
    if (row === null) throw new NotFoundException(PROJECT_NOT_FOUND)
    if (row.ownerUserId === args.userId) return row
    if (row.organizationId === null) throw new NotFoundException(PROJECT_NOT_FOUND)
    const member = await db.orm.public.Member.first({
      organizationId: row.organizationId,
      userId: args.userId,
    })
    if (member === null) throw new NotFoundException(PROJECT_NOT_FOUND)
    return row
  }
}
