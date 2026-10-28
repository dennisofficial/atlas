import { describe, expect, it } from 'bun:test'

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
} from '../new-project-draft'
import { ENewProjectStep, EProjectSource } from '../new-project-types'

const EXISTING = { ...emptyDraft(), repo: 'compai/csa' }
const PROJECTS = [{ name: 'comp-v3' }, { name: 'scratch' }]

describe('nameErrorOf', () => {
  it('flags an empty name', () => {
    expect(nameErrorOf({ name: '  ', projects: PROJECTS })).toBe(ENameError.Empty)
  })

  it('flags a name over the API limit', () => {
    const name = 'x'.repeat(101)
    expect(nameErrorOf({ name, projects: PROJECTS })).toBe(ENameError.TooLong)
  })

  it('flags a duplicate, ignoring case', () => {
    expect(nameErrorOf({ name: 'COMP-V3', projects: PROJECTS })).toBe(ENameError.Duplicate)
  })

  it('allows an unused name', () => {
    expect(nameErrorOf({ name: 'comp-v4', projects: PROJECTS })).toBeNull()
  })
})

describe('draft helpers', () => {
  it('reads the repo and suggests a name from it', () => {
    expect(repoOf(EXISTING)).toBe('compai/csa')
    expect(suggestedName(EXISTING)).toBe('csa')
  })
})

describe('canContinueFromRepository', () => {
  it('requires a picked repository', () => {
    expect(canContinueFromRepository(emptyDraft())).toBe(false)
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
})
