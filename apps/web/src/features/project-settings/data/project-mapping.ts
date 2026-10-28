import { EShipBehavior } from '@dltech/atlas-wire/web'

import { SHIP_BEHAVIORS } from '../fixtures/project-settings'
import type { ProjectView, SaveProjectBody } from './project-api'

export type OverviewDraft = {
  name: string
  description: string
  baseBranch: string
  shipBehavior: EShipBehavior
  additionalRepositories: readonly string[]
}

export type ProjectIdentity = { owner: string; name: string; slug: string; repo: string | null }

export type ShipOption = {
  value: EShipBehavior
  label: string
  description: string
  disabled: boolean
}

export const LEGACY_MERGE_LABEL = 'Merge when green (no longer offered)'
export const LEGACY_MERGE_DESCRIPTION =
  'Atlas no longer offers this. Choose another option to change it.'

export function identityOf(project: ProjectView): ProjectIdentity {
  if (project.repo === null) {
    return { owner: '', name: project.name, slug: project.name, repo: null }
  }
  const [owner = '', repoName = ''] = project.repo.split('/')
  return { owner, name: repoName, slug: project.repo, repo: project.repo }
}

export function overviewDraftOf(project: ProjectView): OverviewDraft {
  return {
    name: project.name,
    description: project.description,
    baseBranch: project.baseBranch ?? '',
    shipBehavior: project.shipBehavior,
    additionalRepositories: project.additionalRepos.map((entry) => entry.repo),
  }
}

export function shipOptionsOf(current: EShipBehavior): ShipOption[] {
  const offered = SHIP_BEHAVIORS.map((item) => ({ ...item, disabled: false }))
  if (offered.some((item) => item.value === current)) return offered
  return [
    ...offered,
    {
      value: current,
      label: LEGACY_MERGE_LABEL,
      description: LEGACY_MERGE_DESCRIPTION,
      disabled: true,
    },
  ]
}

export function saveBodyOf({
  project,
  draft,
}: {
  project: ProjectView
  draft: OverviewDraft
}): SaveProjectBody {
  const branchOf = new Map(project.additionalRepos.map((entry) => [entry.repo, entry.branch]))
  const repos = draft.additionalRepositories
    .map((repo) => repo.trim())
    .filter((repo) => repo !== '')
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
