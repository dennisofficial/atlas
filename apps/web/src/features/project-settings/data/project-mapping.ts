import type { Project } from '@dltech/atlas-wire/web'
import { EShipBehavior } from '@dltech/atlas-wire/web'

import type { SaveProjectBody } from './project-api'

export type OverviewDraft = {
  name: string
  description: string
  baseBranch: string
  shipBehavior: EShipBehavior
  additionalRepositories: readonly string[]
}

export type ProjectIdentity = { owner: string; name: string; slug: string; repo: string | null }

export function identityOf(project: Project): ProjectIdentity {
  if (project.repo === null) {
    return { owner: '', name: project.name, slug: project.name, repo: null }
  }
  const [owner = '', repoName = ''] = project.repo.split('/')
  return { owner, name: repoName, slug: project.repo, repo: project.repo }
}

export function overviewDraftOf(project: Project): OverviewDraft {
  return {
    name: project.name,
    description: project.description,
    baseBranch: project.baseBranch ?? '',
    shipBehavior: project.shipBehavior,
    additionalRepositories: project.additionalRepos.map((entry) => entry.repo),
  }
}

export function saveBodyOf({
  project,
  draft,
}: {
  project: Project
  draft: OverviewDraft
}): SaveProjectBody {
  const branchOf = new Map(project.additionalRepos.map((entry) => [entry.repo, entry.branch]))
  const repos = draft.additionalRepositories.map((repo) => repo.trim()).filter((repo) => repo !== '')
  return {
    name: draft.name.trim(),
    repo: project.repo,
    baseBranch: draft.baseBranch.trim() === '' ? null : draft.baseBranch.trim(),
    additionalRepos: repos.map((repo) => {
      const branch = branchOf.get(repo)
      return branch === undefined ? { repo } : { repo, branch }
    }),
    description: draft.description,
    shipBehavior: draft.shipBehavior,
  }
}

export const draftsEqual = ({ left, right }: { left: OverviewDraft; right: OverviewDraft }) =>
  left.name === right.name &&
  left.description === right.description &&
  left.baseBranch === right.baseBranch &&
  left.shipBehavior === right.shipBehavior &&
  left.additionalRepositories.join('\n') === right.additionalRepositories.join('\n')
