import { describe, expect, test } from 'bun:test'

import { EShipBehavior, PROJECT } from '../../../../fixtures/project-settings'
import {
  availableRepoSlugs,
  branchFromLabel,
  branchItems,
  defaultBranchLabel,
  draftsEqual,
  isShipBehavior,
  repoSlug,
} from '../overview-model'

describe('branchItems', () => {
  test('puts the default entry first and lists the default branch once', () => {
    const items = branchItems('main')
    expect(items[0]).toBe('Default branch (main)')
    expect(items).not.toContain('main')
    expect(items).toContain('release/0.9')
  })
})

describe('branchFromLabel', () => {
  test('maps the default entry to null and passes branches through', () => {
    const label = defaultBranchLabel('main')
    expect(branchFromLabel({ label, defaultBranch: 'main' })).toBeNull()
    expect(branchFromLabel({ label: 'staging', defaultBranch: 'main' })).toBe('staging')
  })
})

describe('availableRepoSlugs', () => {
  test('excludes the project repository and already added ones', () => {
    const slugs = availableRepoSlugs({ project: PROJECT, added: ['dennisofficial/comp-v3'] })
    expect(slugs).not.toContain(repoSlug(PROJECT))
    expect(slugs).not.toContain('dennisofficial/comp-v3')
    expect(slugs).toContain('oven-sh/bun')
  })
})

describe('draftsEqual', () => {
  const base = {
    baseBranch: null,
    shipBehavior: EShipBehavior.OpenPullRequest,
    additionalRepositories: ['a/b'],
  }

  test('is true for equal drafts', () => {
    expect(draftsEqual({ left: base, right: { ...base } })).toBe(true)
  })

  test('detects each field changing', () => {
    expect(draftsEqual({ left: base, right: { ...base, baseBranch: 'staging' } })).toBe(false)
    expect(draftsEqual({ left: base, right: { ...base, shipBehavior: EShipBehavior.Push } })).toBe(
      false,
    )
    expect(
      draftsEqual({ left: base, right: { ...base, additionalRepositories: ['a/b', 'c/d'] } }),
    ).toBe(false)
  })
})

describe('isShipBehavior', () => {
  test('accepts offered behaviors only', () => {
    expect(isShipBehavior('push')).toBe(true)
    expect(isShipBehavior('nope')).toBe(false)
  })
})
