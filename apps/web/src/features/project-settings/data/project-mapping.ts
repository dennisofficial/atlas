import { EShipBehavior } from '@dltech/atlas-wire/web'

import type { Organization } from '@/lib/organization-api'

import { SHIP_BEHAVIORS } from '../fixtures/project-settings'
import type { ProjectView, SaveProjectBody } from './project-api'

export type OverviewDraft = {
  name: string
  description: string
  baseBranch: string
  shipBehavior: EShipBehavior
  additionalRepositories: readonly string[]
  organizationId: string | null
}

export type ProjectIdentity = { owner: string; name: string; slug: string; repo: string | null }

export type ShipOption = {
  value: EShipBehavior
  label: string
  description: string
  disabled: boolean
}

export type WorkspaceOption = { value: string; label: string }

export const PERSONAL_WORKSPACE_VALUE = 'personal'
export const PERSONAL_WORKSPACE_LABEL = 'Personal (no workspace)'
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
    organizationId: project.organizationId,
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

export const workspaceValueOf = (organizationId: string | null): string =>
  organizationId ?? PERSONAL_WORKSPACE_VALUE

export const organizationIdOfValue = (value: string): string | null =>
  value === PERSONAL_WORKSPACE_VALUE ? null : value

export function workspaceOptionsOf({
  organizations,
  current,
}: {
  organizations: readonly Organization[]
  current: string | null
}): WorkspaceOption[] {
  const options = organizations.map((organization) => ({
    value: organization.id,
    label: organization.name,
  }))
  const known = current === null || options.some((option) => option.value === current)
  return [
    { value: PERSONAL_WORKSPACE_VALUE, label: PERSONAL_WORKSPACE_LABEL },
    ...options,
    ...(known ? [] : [{ value: workspaceValueOf(current), label: current ?? '' }]),
  ]
}

export function saveBodyOf({
  project,
  draft,
  includeWorkspace,
}: {
  project: ProjectView
  draft: OverviewDraft
  includeWorkspace: boolean
}): SaveProjectBody {
  const branchOf = new Map(project.additionalRepos.map((entry) => [entry.repo, entry.branch]))
  const repos = draft.additionalRepositories.map((repo) => repo.trim()).filter((repo) => repo !== '')
  const body: SaveProjectBody = {
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
  const workspaceChanged = draft.organizationId !== project.organizationId
  return includeWorkspace && workspaceChanged ? { ...body, organizationId: draft.organizationId } : body
}

export const draftsEqual = ({ left, right }: { left: OverviewDraft; right: OverviewDraft }) =>
  left.name === right.name &&
  left.description === right.description &&
  left.baseBranch === right.baseBranch &&
  left.shipBehavior === right.shipBehavior &&
  left.organizationId === right.organizationId &&
  left.additionalRepositories.join('\n') === right.additionalRepositories.join('\n')
