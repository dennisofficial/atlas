import { describe, expect, test } from 'bun:test'

import {
  additionalReposOf,
  ENameError,
  emptyDraft,
  nameErrorOf,
  nextStep,
  stepPosition,
  visibleNameError,
} from '../new-project-draft'
import { additionalRepoChoices, parseRepoInput, ERepoInputKind } from '../new-project-repos'
import { NEW_PROJECT_REPOS } from '../new-project-fixtures'
import { ENewProjectStep, EProjectSource, type ProjectDraft } from '../new-project-types'

const draftWith = (changes: Partial<ProjectDraft>): ProjectDraft => ({
  ...emptyDraft(),
  repo: 'dennisofficial/atlas',
  ...changes,
})

describe('parseRepoInput', () => {
  test('accepts owner/name and github urls', () => {
    const expected = { kind: ERepoInputKind.Valid, repo: 'a/b' }
    expect(parseRepoInput('a/b')).toEqual(expected)
    expect(parseRepoInput('https://github.com/a/b.git')).toEqual(expected)
    expect(parseRepoInput('git@github.com:a/b')).toEqual(expected)
  })

  test('rejects foreign hosts and blanks', () => {
    expect(parseRepoInput('https://gitlab.com/a/b').kind).toBe(ERepoInputKind.Invalid)
    expect(parseRepoInput('  ').kind).toBe(ERepoInputKind.Empty)
  })
})

describe('additionalReposOf', () => {
  test('is empty without a main repository', () => {
    expect(additionalReposOf(draftWith({ source: EProjectSource.NoRepo }))).toEqual([])
  })

  test('skips blank rows and normalises urls', () => {
    const draft = draftWith({ additionalRepos: ['', 'https://github.com/dltech/infra'] })
    expect(additionalReposOf(draft)).toEqual(['dltech/infra'])
  })

  test('is null for invalid or duplicate names', () => {
    expect(additionalReposOf(draftWith({ additionalRepos: ['nope'] }))).toBeNull()
    expect(additionalReposOf(draftWith({ additionalRepos: ['x/atlas'] }))).toBeNull()
    expect(additionalReposOf(draftWith({ additionalRepos: ['a/b', 'c/b'] }))).toBeNull()
  })
})

describe('additionalRepoChoices', () => {
  test('hides taken repositories', () => {
    const choices = additionalRepoChoices({
      repos: NEW_PROJECT_REPOS,
      query: '',
      taken: ['dennisofficial/atlas'],
    })
    expect(choices).not.toContain('dennisofficial/atlas')
    expect(choices).toContain('dennisofficial/rs-crm')
  })
})

describe('nameErrorOf', () => {
  test('flags empty, too long and duplicate names', () => {
    expect(nameErrorOf({ name: ' ', takenNames: [] })).toBe(ENameError.Empty)
    expect(nameErrorOf({ name: 'x'.repeat(101), takenNames: [] })).toBe(ENameError.TooLong)
    expect(nameErrorOf({ name: 'Atlas', takenNames: ['atlas'] })).toBe(ENameError.Duplicate)
    expect(nameErrorOf({ name: 'new', takenNames: ['atlas'] })).toBeNull()
  })

  test('hides the empty error until touched', () => {
    expect(visibleNameError({ error: ENameError.Empty, touched: false })).toBeNull()
    expect(visibleNameError({ error: ENameError.Empty, touched: true })).toBe(ENameError.Empty)
  })
})

describe('steps', () => {
  test('no-repo projects skip the repository step', () => {
    const source = EProjectSource.NoRepo
    expect(nextStep({ step: ENewProjectStep.Source, source })).toBe(ENewProjectStep.Details)
    expect(stepPosition({ step: ENewProjectStep.Details, source })).toEqual({
      current: 2,
      total: 2,
    })
  })
})
