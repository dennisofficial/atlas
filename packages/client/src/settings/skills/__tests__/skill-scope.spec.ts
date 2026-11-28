import { describe, expect, it } from 'bun:test'
import { ESkillScope } from '@dltech/atlas-wire/web'

import {
  groupSkillTarget,
  personalSkillTarget,
  projectSkillTarget,
  skillsDescriptionOf,
} from '../skill-scope'

describe('skill scope targets', () => {
  it('builds the input the skills router takes at each scope', () => {
    expect(personalSkillTarget).toEqual({ scope: ESkillScope.Personal })
    expect(projectSkillTarget({ projectId: 'p1' })).toEqual({
      scope: ESkillScope.Project,
      projectId: 'p1',
    })
    expect(groupSkillTarget({ groupId: 'g1' })).toEqual({
      scope: ESkillScope.Group,
      groupId: 'g1',
    })
  })
})

describe('skillsDescriptionOf', () => {
  it('describes where each scope stores its skills', () => {
    expect(skillsDescriptionOf(personalSkillTarget)).toContain('every thread')
    expect(skillsDescriptionOf(projectSkillTarget({ projectId: 'p1' }))).toContain('this project')
    expect(skillsDescriptionOf(groupSkillTarget({ groupId: 'g1' }))).toContain(
      'every project in it',
    )
  })
})
