import {
  EShipBehavior,
  GITHUB_REPO_PATTERN,
  MAX_ADDITIONAL_REPOS,
  type Project,
} from '@dltech/atlas-wire/web'

export type IProjectOverviewDraft = {
  name: string
  description: string
  baseBranch: string
  shipBehavior: EShipBehavior
  additionalRepositories: readonly string[]
}

export type IProjectIdentity = {
  owner: string
  name: string
  slug: string
  repo: string | null
}

export type IShipOption = {
  value: EShipBehavior
  label: string
  description: string
  disabled: boolean
}

export const LEGACY_MERGE_LABEL = 'Merge when green (no longer offered)'
export const LEGACY_MERGE_DESCRIPTION =
  'Atlas no longer offers this. Choose another option to change it.'

export const SHIP_BEHAVIORS: readonly {
  value: EShipBehavior
  label: string
  description: string
}[] = [
  {
    value: EShipBehavior.OpenPullRequest,
    label: 'Open pull request',
    description: 'Push a branch and open a PR for review.',
  },
  {
    value: EShipBehavior.Push,
    label: 'Push branch',
    description: 'Push the branch; you open the PR yourself.',
  },
]

export const identityOf = (project: Project): IProjectIdentity => {
  if (project.repo === null) {
    return { owner: '', name: project.name, slug: project.name, repo: null }
  }
  const [owner = '', repoName = ''] = project.repo.split('/')
  return { owner, name: repoName, slug: project.repo, repo: project.repo }
}

export const overviewDraftOf = (project: Project): IProjectOverviewDraft => ({
  name: project.name,
  description: project.description,
  baseBranch: project.baseBranch ?? '',
  shipBehavior: project.shipBehavior,
  additionalRepositories: project.additionalRepos.map((entry) => entry.repo),
})

export const shipOptionsOf = (current: EShipBehavior): IShipOption[] => {
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

export const additionalRepositoryProblem = ({ value }: { value: string }): string | null => {
  const trimmed = value.trim()
  if (trimmed === '') return null
  return GITHUB_REPO_PATTERN.test(trimmed) ? null : 'Use owner/name, or paste a github.com URL.'
}

export const canAddAdditionalRepository = ({
  repositories,
}: {
  repositories: readonly string[]
}): boolean => repositories.length < MAX_ADDITIONAL_REPOS

export const addAdditionalRepository = (repositories: readonly string[]): readonly string[] => [
  ...repositories,
  '',
]

export const removeAdditionalRepository = ({
  repositories,
  index,
}: {
  repositories: readonly string[]
  index: number
}): readonly string[] => repositories.filter((_, position) => position !== index)

export const editAdditionalRepository = ({
  repositories,
  index,
  value,
}: {
  repositories: readonly string[]
  index: number
  value: string
}): readonly string[] =>
  repositories.map((repository, position) => (position === index ? value : repository))

export const overviewDraftsEqual = ({
  left,
  right,
}: {
  left: IProjectOverviewDraft
  right: IProjectOverviewDraft
}): boolean =>
  left.name === right.name &&
  left.description === right.description &&
  left.baseBranch === right.baseBranch &&
  left.shipBehavior === right.shipBehavior &&
  left.additionalRepositories.join('\n') === right.additionalRepositories.join('\n')

export const overviewDraftIsValid = ({ draft }: { draft: IProjectOverviewDraft }): boolean =>
  draft.name.trim() !== '' &&
  draft.additionalRepositories.every(
    (repository) => additionalRepositoryProblem({ value: repository }) === null,
  )

export const overviewSaveBodyOf = ({
  project,
  draft,
}: {
  project: Project
  draft: IProjectOverviewDraft
}) => {
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
