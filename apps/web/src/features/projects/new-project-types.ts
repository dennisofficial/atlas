import type { EShipBehavior } from '@dltech/atlas-wire/web'

export enum ENewProjectStep {
  Source = 'Source',
  Repository = 'Repository',
  Details = 'Details',
}

export enum EProjectSource {
  Existing = 'Existing',
  NoRepo = 'NoRepo',
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
