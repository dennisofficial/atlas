import { ERepoInputKind, parseRepoInput } from './new-project-repos'
import {
  ENewProjectStep,
  EProjectSource,
  EShipBehavior,
  type ProjectDraft,
} from './new-project-types'

export const MAX_PROJECT_NAME_LENGTH = 100
export const MAX_ADDITIONAL_REPOS = 10
export const MAX_SETUP_SCRIPT_LENGTH = 20000

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

export const BAD_ADDITIONAL_REPOS_MESSAGE =
  'Each additional repository must be a GitHub URL or owner/name, and not repeat another.'

export function emptyDraft(): ProjectDraft {
  return {
    source: EProjectSource.Existing,
    repo: null,
    repoQuery: '',
    branch: null,
    name: '',
    nameTouched: false,
    description: '',
    additionalRepos: [],
    shipBehavior: EShipBehavior.OpenPullRequest,
    vcpus: null,
    setupScript: '',
  }
}

export function repoOf(draft: ProjectDraft): string | null {
  return draft.source === EProjectSource.Existing ? draft.repo : null
}

export const suggestedName = (draft: ProjectDraft): string => repoOf(draft)?.split('/')[1] ?? ''

export function nameErrorOf({
  name,
  takenNames,
}: {
  name: string
  takenNames: readonly string[]
}): ENameError | null {
  const trimmed = name.trim()
  if (!trimmed) return ENameError.Empty
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) return ENameError.TooLong
  const taken = takenNames.some((taken) => taken.toLowerCase() === trimmed.toLowerCase())
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

export function additionalReposOf(draft: ProjectDraft): string[] | null {
  if (repoOf(draft) === null) return []
  const seen = new Set([repoOf(draft)?.split('/')[1]?.toLowerCase()])
  const repos: string[] = []
  for (const entry of draft.additionalRepos) {
    const parsed = parseRepoInput(entry)
    if (parsed.kind === ERepoInputKind.Empty) continue
    if (parsed.kind === ERepoInputKind.Invalid) return null
    const name = parsed.repo.split('/')[1]?.toLowerCase()
    if (seen.has(name)) return null
    seen.add(name)
    repos.push(parsed.repo)
  }
  return repos
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
