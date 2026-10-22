import { describe, expect, it } from 'bun:test'

import { PERSONAL_WORKSPACE_VALUE } from '@/features/project-settings/data/project-mapping'

import {
  canContinueFromRepository,
  createBodyOf,
  emptyDraft,
  ENameError,
  nameErrorOf,
  nextStep,
  previousStep,
  repoOf,
  stepPosition,
  suggestedName,
  visibleNameError,
} from '../new-project-draft'
import { ENewProjectStep, EProjectSource } from '../new-project-types'

const EXISTING = { ...emptyDraft('org1'), repo: 'compai/csa' }
const PROJECTS = [
  { name: 'comp-v3', organizationId: 'org1' },
  { name: 'scratch', organizationId: null },
]

describe('nameErrorOf', () => {
  it('flags an empty name', () => {
    expect(nameErrorOf({ name: '  ', ownerId: 'org1', projects: PROJECTS })).toBe(ENameError.Empty)
  })

  it('flags a name over the API limit', () => {
    const name = 'x'.repeat(101)
    expect(nameErrorOf({ name, ownerId: 'org1', projects: PROJECTS })).toBe(ENameError.TooLong)
  })

  it('flags a duplicate in the same workspace, ignoring case', () => {
    expect(nameErrorOf({ name: 'COMP-V3', ownerId: 'org1', projects: PROJECTS })).toBe(
      ENameError.Duplicate,
    )
  })

  it('allows the same name in a different workspace', () => {
    expect(nameErrorOf({ name: 'comp-v3', ownerId: 'org2', projects: PROJECTS })).toBeNull()
    expect(
      nameErrorOf({ name: 'comp-v3', ownerId: PERSONAL_WORKSPACE_VALUE, projects: PROJECTS }),
    ).toBeNull()
  })

  it('scopes private projects by a null organization', () => {
    expect(
      nameErrorOf({ name: 'Scratch', ownerId: PERSONAL_WORKSPACE_VALUE, projects: PROJECTS }),
    ).toBe(ENameError.Duplicate)
    expect(nameErrorOf({ name: 'scratch', ownerId: 'org1', projects: PROJECTS })).toBeNull()
  })

  it('treats a missing organization id as private', () => {
    const projects = [{ name: 'solo' }]
    expect(nameErrorOf({ name: 'solo', ownerId: PERSONAL_WORKSPACE_VALUE, projects })).toBe(
      ENameError.Duplicate,
    )
  })
})

describe('visibleNameError', () => {
  it('hides the empty error until the field is touched', () => {
    expect(visibleNameError({ error: ENameError.Empty, touched: false })).toBeNull()
    expect(visibleNameError({ error: ENameError.Empty, touched: true })).toBe(ENameError.Empty)
  })

  it('always shows other errors', () => {
    expect(visibleNameError({ error: ENameError.Duplicate, touched: false })).toBe(
      ENameError.Duplicate,
    )
  })
})

describe('repoOf and suggestedName', () => {
  it('is null with no repository, even if one was picked earlier', () => {
    const draft = { ...EXISTING, source: EProjectSource.NoRepo }
    expect(repoOf(draft)).toBeNull()
    expect(suggestedName(draft)).toBe('')
  })

  it('uses the picked repository', () => {
    expect(repoOf(EXISTING)).toBe('compai/csa')
    expect(suggestedName(EXISTING)).toBe('csa')
  })
})

describe('emptyDraft', () => {
  it('defaults to private when there is no workspace', () => {
    expect(emptyDraft(null).ownerId).toBe(PERSONAL_WORKSPACE_VALUE)
  })
})

describe('canContinueFromRepository', () => {
  it('requires a picked repository', () => {
    expect(canContinueFromRepository(emptyDraft(null))).toBe(false)
    expect(canContinueFromRepository(EXISTING)).toBe(true)
  })
})

describe('step navigation', () => {
  it('skips the repository step when there is no repository', () => {
    expect(nextStep({ step: ENewProjectStep.Source, source: EProjectSource.NoRepo })).toBe(
      ENewProjectStep.Details,
    )
    expect(previousStep({ step: ENewProjectStep.Details, source: EProjectSource.NoRepo })).toBe(
      ENewProjectStep.Source,
    )
    expect(stepPosition({ step: ENewProjectStep.Details, source: EProjectSource.NoRepo })).toEqual({
      current: 2,
      total: 2,
    })
  })

  it('walks all three steps for a repository source', () => {
    expect(nextStep({ step: ENewProjectStep.Source, source: EProjectSource.Existing })).toBe(
      ENewProjectStep.Repository,
    )
    expect(nextStep({ step: ENewProjectStep.Repository, source: EProjectSource.Existing })).toBe(
      ENewProjectStep.Details,
    )
    expect(previousStep({ step: ENewProjectStep.Details, source: EProjectSource.Existing })).toBe(
      ENewProjectStep.Repository,
    )
    expect(
      stepPosition({ step: ENewProjectStep.Details, source: EProjectSource.Existing }),
    ).toEqual({ current: 3, total: 3 })
  })
})

describe('createBodyOf', () => {
  it('sends the repo, a null base branch for the default branch, and a trimmed description', () => {
    const draft = { ...EXISTING, description: '  Slack triage  ' }
    expect(createBodyOf({ draft, name: ' csa-2 ' })).toEqual({
      name: 'csa-2',
      repo: 'compai/csa',
      baseBranch: null,
      additionalRepos: [],
      description: 'Slack triage',
      organizationId: 'org1',
    })
  })

  it('sends the chosen branch', () => {
    const draft = { ...EXISTING, branch: 'staging' }
    expect(createBodyOf({ draft, name: 'x' }).baseBranch).toBe('staging')
  })

  it('has no repo and no branch for NoRepo', () => {
    const draft = { ...EXISTING, source: EProjectSource.NoRepo, branch: 'staging' }
    const body = createBodyOf({ draft, name: 'x' })
    expect(body.repo).toBeNull()
    expect(body.baseBranch).toBeNull()
  })

  it('sends a null organization for Private', () => {
    const draft = emptyDraft(PERSONAL_WORKSPACE_VALUE)
    expect(createBodyOf({ draft, name: 'x' }).organizationId).toBeNull()
  })
})
