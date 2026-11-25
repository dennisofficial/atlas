import { describe, expect, it } from 'bun:test'

import { EAccessScope, accessScopeSchema } from '../web/access-grants-wire'
import {
  EConfigLayer,
  PROJECT_GROUP_NAME_MAX,
  configLayerSchema,
  projectGroupAssignSchema,
  projectGroupSaveSchema,
} from '../project-group-wire'

describe('project group wire', () => {
  it('trims a name and refuses an empty or oversized one', () => {
    expect(projectGroupSaveSchema.parse({ name: '  Comp AI  ' })).toEqual({ name: 'Comp AI' })
    expect(projectGroupSaveSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(
      projectGroupSaveSchema.safeParse({ name: 'x'.repeat(PROJECT_GROUP_NAME_MAX + 1) }).success,
    ).toBe(false)
    expect(projectGroupSaveSchema.safeParse({ name: 'ok', extra: true }).success).toBe(false)
  })

  it('assigns a project to a group or to none', () => {
    expect(projectGroupAssignSchema.parse({ projectId: 'p', groupId: 'g' }).groupId).toBe('g')
    expect(projectGroupAssignSchema.parse({ projectId: 'p', groupId: null }).groupId).toBeNull()
    expect(projectGroupAssignSchema.safeParse({ projectId: 'p', groupId: '' }).success).toBe(false)
  })
})

describe('the group access scope', () => {
  it('names a group by id', () => {
    expect(accessScopeSchema.parse({ kind: EAccessScope.Group, groupId: 'g' })).toEqual({
      kind: EAccessScope.Group,
      groupId: 'g',
    })
    expect(accessScopeSchema.safeParse({ kind: EAccessScope.Group }).success).toBe(false)
    expect(accessScopeSchema.safeParse({ kind: EAccessScope.Group, projectId: 'p' }).success).toBe(
      false,
    )
  })
})

describe('configLayerSchema', () => {
  it('accepts exactly the five layers in precedence order', () => {
    expect(configLayerSchema.options).toEqual([
      EConfigLayer.BuiltIn,
      EConfigLayer.Personal,
      EConfigLayer.Group,
      EConfigLayer.Project,
      EConfigLayer.Repo,
    ])
  })
})
