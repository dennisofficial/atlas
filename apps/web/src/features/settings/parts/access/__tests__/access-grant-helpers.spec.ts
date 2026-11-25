import { describe, expect, it } from 'bun:test'

import { EAccessScope, type AccessGrant } from '@dltech/atlas-wire/web'

import {
  EMemberKind,
  fileMountsQueryKeyOf,
  grantHoldingMember,
  memberOptions,
  scopeKeyOf,
  secretsQueryKeyOf,
  toggledMember,
} from '../access-grant-helpers'

const grantOf = (args: Partial<AccessGrant> & { id: string; name: string }): AccessGrant => ({
  instruction: '',
  secretNames: [],
  filePaths: [],
  updatedAt: '2026-11-25T00:00:00.000Z',
  ...args,
})

const GRANTS: AccessGrant[] = [
  grantOf({ id: 'g1', name: 'PlanetScale', secretNames: ['PSCALE_TOKEN', 'PSCALE_ORG'] }),
  grantOf({ id: 'g2', name: 'Deploy', filePaths: ['/root/.config/gh/hosts.yml'] }),
]

describe('grantHoldingMember', () => {
  it('finds the grant that holds a secret', () => {
    expect(
      grantHoldingMember({ grants: GRANTS, kind: EMemberKind.Secret, name: 'PSCALE_TOKEN' })?.name,
    ).toBe('PlanetScale')
  })

  it('finds the grant that holds a file and separates the kinds', () => {
    expect(
      grantHoldingMember({
        grants: GRANTS,
        kind: EMemberKind.File,
        name: '/root/.config/gh/hosts.yml',
      })?.name,
    ).toBe('Deploy')
    expect(
      grantHoldingMember({
        grants: GRANTS,
        kind: EMemberKind.Secret,
        name: '/root/.config/gh/hosts.yml',
      }),
    ).toBeNull()
  })

  it('returns null for an ungrouped member', () => {
    expect(
      grantHoldingMember({ grants: GRANTS, kind: EMemberKind.Secret, name: 'OTHER' }),
    ).toBeNull()
  })
})

describe('memberOptions', () => {
  it('lists every name once, sorted, with the holding grant', () => {
    expect(
      memberOptions({
        grants: GRANTS,
        kind: EMemberKind.Secret,
        names: ['PSCALE_TOKEN', 'OTHER', 'PSCALE_TOKEN', 'PSCALE_ORG'],
      }),
    ).toEqual([
      { kind: EMemberKind.Secret, name: 'OTHER', holder: null },
      { kind: EMemberKind.Secret, name: 'PSCALE_ORG', holder: 'PlanetScale' },
      { kind: EMemberKind.Secret, name: 'PSCALE_TOKEN', holder: 'PlanetScale' },
    ])
  })
})

describe('toggledMember', () => {
  it('adds a missing member and removes a present one', () => {
    expect(toggledMember(['A'], 'B')).toEqual(['A', 'B'])
    expect(toggledMember(['A', 'B'], 'A')).toEqual(['B'])
  })
})

describe('query keys', () => {
  const personal = { kind: EAccessScope.Personal } as const
  const project = { kind: EAccessScope.Project, projectId: 'prj_1' } as const

  it('keys grants per scope', () => {
    expect(scopeKeyOf(personal)).toBe('personal')
    expect(scopeKeyOf(project)).toBe('project:prj_1')
  })

  it('points at the secrets and mounts queries of the scope', () => {
    expect(secretsQueryKeyOf(personal)).toBe('personal-secrets')
    expect(secretsQueryKeyOf(project)).toBe('secrets:prj_1')
    expect(fileMountsQueryKeyOf(personal)).toBeNull()
    expect(fileMountsQueryKeyOf(project)).toBe('file-mounts:prj_1')
  })
})
