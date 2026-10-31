export enum ENewProjectStep {
  Source = 'Source',
  Repository = 'Repository',
  Details = 'Details',
}

export enum EProjectSource {
  Existing = 'Existing',
  NoRepo = 'NoRepo',
}

export enum EShipBehavior {
  OpenPullRequest = 'open-pr',
  Push = 'push',
}

export interface GithubRepoSummary {
  fullName: string
  defaultBranch: string
  isPrivate: boolean
  pushedAt: string | null
}

export interface ProjectDraft {
  source: EProjectSource
  repo: string | null
  repoQuery: string
  branch: string | null
  name: string
  nameTouched: boolean
  description: string
  additionalRepos: readonly string[]
  shipBehavior: EShipBehavior
  vcpus: number | null
  setupScript: string
}

export type DraftPatch = (patch: Partial<ProjectDraft>) => void
