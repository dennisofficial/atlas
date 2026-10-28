import { MAX_PROJECT_NAME_LENGTH, type Project } from '@dltech/atlas-wire/web'

import type { CreateProjectBody } from '@/features/project-settings/data/project-api'

import { ENewProjectStep, EProjectSource, type ProjectDraft } from './new-project-types'

export enum ENameError {
  Empty = 'Empty',
  TooLong = 'TooLong',
  Duplicate = 'Duplicate',
}

export const NAME_ERROR_MESSAGES: Record<ENameError, string> = {
  [ENameError.Empty]: 'Give the project a name.',
  [ENameError.TooLong]: `Keep the name to ${MAX_PROJECT_NAME_LENGTH} characters or fewer.`,
  [ENameError.Duplicate]: 'You already have a project with that name.',
}

export function emptyDraft(): ProjectDraft {
  return {
    source: EProjectSource.Existing,
    repo: null,
    repoQuery: '',
    branch: null,
    name: '',
    nameTouched: false,
    description: '',
  }
}

export function repoOf(draft: ProjectDraft): string | null {
  return draft.source === EProjectSource.Existing ? draft.repo : null
}

export const suggestedName = (draft: ProjectDraft): string => repoOf(draft)?.split('/')[1] ?? ''

export function nameErrorOf({
  name,
  projects,
}: {
  name: string
  projects: readonly Pick<Project, 'name'>[]
}): ENameError | null {
  const trimmed = name.trim()
  if (!trimmed) return ENameError.Empty
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) return ENameError.TooLong
  const taken = projects.some((project) => project.name.toLowerCase() === trimmed.toLowerCase())
  return taken ? ENameError.Duplicate : null
}

export function visibleNameError({
  error,
  touched,
}: {
  error: ENameError | null
  touched: boolean
}): ENameError | null {
  if (error === ENameError.Empty && !touched) return null
  return error
}

export const canContinueFromRepository = (draft: ProjectDraft): boolean => draft.repo !== null

export function nextStep({
  step,
  source,
}: {
  step: ENewProjectStep
  source: EProjectSource
}): ENewProjectStep {
  if (step === ENewProjectStep.Source) {
    return source === EProjectSource.NoRepo ? ENewProjectStep.Details : ENewProjectStep.Repository
  }
  return ENewProjectStep.Details
}

export function previousStep({
  step,
  source,
}: {
  step: ENewProjectStep
  source: EProjectSource
}): ENewProjectStep {
  if (step === ENewProjectStep.Details && source !== EProjectSource.NoRepo) {
    return ENewProjectStep.Repository
  }
  return ENewProjectStep.Source
}

export function stepPosition({ step, source }: { step: ENewProjectStep; source: EProjectSource }): {
  current: number
  total: number
} {
  const total = source === EProjectSource.NoRepo ? 2 : 3
  if (step === ENewProjectStep.Source) return { current: 1, total }
  if (step === ENewProjectStep.Repository) return { current: 2, total }
  return { current: total, total }
}

export function createBodyOf({
  draft,
  name,
}: {
  draft: ProjectDraft
  name: string
}): CreateProjectBody {
  const repo = repoOf(draft)
  return {
    name: name.trim(),
    repo,
    baseBranch: repo === null ? null : draft.branch,
    additionalRepos: [],
    description: draft.description.trim(),
  }
}
