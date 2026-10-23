import {
  GITHUB_REPOS,
  PROJECT_BRANCHES,
  EShipBehavior,
  type GithubRepo,
  type ProjectFixture,
} from '../../../fixtures/project-settings'

export enum EOverviewPicker {
  Branch = 'branch',
  Repository = 'repository',
}

export type OverviewDraft = Pick<
  ProjectFixture,
  'baseBranch' | 'shipBehavior' | 'additionalRepositories'
>

export function repoSlug(repo: Pick<GithubRepo, 'owner' | 'name'>): string {
  return `${repo.owner}/${repo.name}`
}

export function findRepo(slug: string): GithubRepo | undefined {
  return GITHUB_REPOS.find((repo) => repoSlug(repo) === slug)
}

export function defaultBranchLabel(defaultBranch: string): string {
  return `Default branch (${defaultBranch})`
}

export function branchItems(defaultBranch: string): string[] {
  const others = PROJECT_BRANCHES.filter((branch) => branch !== defaultBranch)
  return [defaultBranchLabel(defaultBranch), ...others]
}

export function branchFromLabel({
  label,
  defaultBranch,
}: {
  label: string
  defaultBranch: string
}): string | null {
  return label === defaultBranchLabel(defaultBranch) ? null : label
}

export function availableRepoSlugs({
  project,
  added,
}: {
  project: Pick<GithubRepo, 'owner' | 'name'>
  added: readonly string[]
}): string[] {
  const taken = new Set([repoSlug(project), ...added])
  return GITHUB_REPOS.map(repoSlug).filter((slug) => !taken.has(slug))
}

export function draftsEqual({
  left,
  right,
}: {
  left: OverviewDraft
  right: OverviewDraft
}): boolean {
  return (
    left.baseBranch === right.baseBranch &&
    left.shipBehavior === right.shipBehavior &&
    left.additionalRepositories.join('\n') === right.additionalRepositories.join('\n')
  )
}

export function isShipBehavior(value: unknown): value is EShipBehavior {
  return Object.values(EShipBehavior).some((behavior) => behavior === value)
}
