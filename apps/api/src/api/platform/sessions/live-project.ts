import type { Row } from '@dltech/atlas-db'
import { projectRepoSchema, type Project, type ProjectRepo } from '@dltech/atlas-wire'
import { EShipBehavior } from '@dltech/atlas-wire/web'

const repoListSchema = projectRepoSchema.array()

export const reposOf = (row: Row<'Project'>): ProjectRepo[] => {
  const parsed = repoListSchema.safeParse(row.additionalRepos)
  return parsed.success ? parsed.data : []
}

const shipBehaviorOf = (stored: string): EShipBehavior =>
  Object.values(EShipBehavior).find((candidate) => candidate === stored) ??
  EShipBehavior.OpenPullRequest

export function toProject(row: Row<'Project'>): Project {
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
