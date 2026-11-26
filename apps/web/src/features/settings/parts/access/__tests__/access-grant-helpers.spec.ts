import { describe, expect, it } from 'bun:test'

import { EAccessScope, type AccessGrant } from '@dltech/atlas-wire/web'

import {
  deleteGrantDescription,
  grantMoveBranchesOf,
  moveTargetsOf,
  scopeKeyOf,
} from '../access-grant-helpers'

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

describe('grantMoveBranchesOf', () => {
  const GROUPS = [
    { id: 'grp_1', name: 'Comp AI' },
    { id: 'grp_2', name: 'Personal projects' },
  ]
  const PROJECTS = [
    { id: 'prj_1', name: 'atlas' },
    { id: 'prj_2', name: 'other' },
  ]

  const labelsOf = (branches: ReturnType<typeof grantMoveBranchesOf>) =>
    branches.map((branch) => ({
      label: branch.label,
      targets: branch.targets.map((target) => target.name),
    }))

  it('offers every other layer from the personal scope', () => {
    expect(
      labelsOf(
        grantMoveBranchesOf({
          scope: { kind: EAccessScope.Personal },
          groups: GROUPS,
          projects: PROJECTS,
        }),
      ),
    ).toEqual([
      { label: 'Group', targets: ['Comp AI', 'Personal projects'] },
      { label: 'Project', targets: ['atlas', 'other'] },
    ])
  })

  it('leaves the current project and the personal layer offer', () => {
    const branches = grantMoveBranchesOf({
      scope: { kind: EAccessScope.Project, projectId: 'prj_1' },
      groups: GROUPS,
      projects: PROJECTS,
    })
    expect(labelsOf(branches)).toEqual([
      { label: 'Personal', targets: ['Personal'] },
      { label: 'Group', targets: ['Comp AI', 'Personal projects'] },
      { label: 'Project', targets: ['other'] },
    ])
    expect(branches[0]?.targets[0]?.scope).toEqual({ kind: EAccessScope.Personal })
  })

  it('drops a branch that has no targets left', () => {
    expect(
      labelsOf(
        grantMoveBranchesOf({
          scope: { kind: EAccessScope.Group, groupId: 'grp_1' },
          groups: GROUPS,
          projects: [],
        }),
      ),
    ).toEqual([
      { label: 'Personal', targets: ['Personal'] },
      { label: 'Group', targets: ['Personal projects'] },
    ])
  })

  it('names the scope each target moves to', () => {
    const branches = grantMoveBranchesOf({
      scope: { kind: EAccessScope.Personal },
      groups: GROUPS,
      projects: PROJECTS,
    })
    expect(branches[0]?.targets[1]?.scope).toEqual({
      kind: EAccessScope.Group,
      groupId: 'grp_2',
    })
    expect(branches[1]?.targets[0]?.scope).toEqual({
      kind: EAccessScope.Project,
      projectId: 'prj_1',
    })
  })
})
