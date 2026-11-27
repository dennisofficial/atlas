import { describe, expect, it } from 'bun:test'

import { EShipBehavior, type Project } from '@dltech/atlas-wire/web'

import {
  groupCandidatesOf,
  groupMemberSummaryOf,
  groupMembersOf,
  groupNameProblem,
} from '../groups'

const project = ({ id, groupId }: { id: string; groupId: string | null }): Project => ({
  id,
  name: id,
  repo: null,
  baseBranch: null,
  additionalRepos: [],
  groupId,
  description: '',
  shipBehavior: EShipBehavior.OpenPullRequest,
  createdAt: '',
  updatedAt: '',
})

describe('groupNameProblem', () => {
  it('requires a name and caps its length', () => {
    expect(groupNameProblem({ name: '  ' })).not.toBeNull()
    expect(groupNameProblem({ name: 'x'.repeat(81) })).not.toBeNull()
    expect(groupNameProblem({ name: ' Comp AI ' })).toBeNull()
  })
})

describe('group membership', () => {
  const projects = [
    project({ id: 'inside', groupId: 'g1' }),
    project({ id: 'elsewhere', groupId: 'g2' }),
    project({ id: 'loose', groupId: null }),
  ]

  it('splits members from the assignable candidates', () => {
    expect(groupMembersOf({ projects, groupId: 'g1' }).map((item) => item.id)).toEqual(['inside'])
    expect(groupCandidatesOf({ projects, groupId: 'g1' }).map((item) => item.id)).toEqual([
      'elsewhere',
      'loose',
    ])
  })

  it('counts members in words', () => {
    expect(groupMemberSummaryOf(0)).toBe('No projects in this group yet.')
    expect(groupMemberSummaryOf(1)).toBe('1 project')
    expect(groupMemberSummaryOf(3)).toBe('3 projects')
  })
})
