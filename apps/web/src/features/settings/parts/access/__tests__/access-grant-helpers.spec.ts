import { describe, expect, it } from 'bun:test'

import { EAccessScope, type AccessGrant } from '@dltech/atlas-wire/web'

import { deleteGrantDescription, moveTargetsOf, scopeKeyOf } from '../access-grant-helpers'

const grantOf = (args: Partial<AccessGrant> & { id: string; name: string }): AccessGrant => ({
  instruction: '',
  secrets: [],
  files: [],
  updatedAt: '2026-11-25T00:00:00.000Z',
  ...args,
})

const GRANTS: AccessGrant[] = [
  grantOf({
    id: 'g1',
    name: 'PlanetScale',
    secrets: [
      { name: 'PSCALE_TOKEN', updatedAt: '2026-11-25T00:00:00.000Z' },
      { name: 'PSCALE_ORG', updatedAt: '2026-11-25T00:00:00.000Z' },
    ],
  }),
  grantOf({
    id: 'g2',
    name: 'Deploy',
    files: [{ path: '~/.config/gh/hosts.yml', mode: 384, updatedAt: '2026-11-25T00:00:00.000Z' }],
  }),
]

describe('scopeKeyOf', () => {
  it('keys grants per scope', () => {
    expect(scopeKeyOf({ kind: EAccessScope.Personal })).toBe('personal')
    expect(scopeKeyOf({ kind: EAccessScope.Project, projectId: 'prj_1' })).toBe('project:prj_1')
  })
})

describe('moveTargetsOf', () => {
  it('lists every other grant', () => {
    expect(moveTargetsOf({ grants: GRANTS, fromGrantId: 'g1' }).map((grant) => grant.name)).toEqual(
      ['Deploy'],
    )
  })
})

describe('deleteGrantDescription', () => {
  it('counts the members the delete removes', () => {
    expect(deleteGrantDescription(GRANTS[0] as AccessGrant)).toBe(
      'Deletes the grant and its 2 secrets. This cannot be undone.',
    )
    expect(deleteGrantDescription(GRANTS[1] as AccessGrant)).toBe(
      'Deletes the grant and its 1 file. This cannot be undone.',
    )
    expect(
      deleteGrantDescription(
        grantOf({
          id: 'g3',
          name: 'Both',
          secrets: [{ name: 'A', updatedAt: 'x' }],
          files: [
            { path: 'a', mode: 384, updatedAt: 'x' },
            { path: 'b', mode: 384, updatedAt: 'x' },
          ],
        }),
      ),
    ).toBe('Deletes the grant and its 1 secret and 2 files. This cannot be undone.')
  })

  it('says so when the grant holds nothing', () => {
    expect(deleteGrantDescription(grantOf({ id: 'g4', name: 'Empty' }))).toBe(
      'The grant has no secrets or files. This cannot be undone.',
    )
  })
})
