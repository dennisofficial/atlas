import { ESkillScope, type SkillScopeInput } from '@dltech/atlas-wire/web'

export type SkillScopeTarget = SkillScopeInput

export const personalSkillTarget: SkillScopeTarget = { scope: ESkillScope.Personal }

export const projectSkillTarget = ({ projectId }: { projectId: string }): SkillScopeTarget => ({
  scope: ESkillScope.Project,
  projectId,
})

export const groupSkillTarget = ({ groupId }: { groupId: string }): SkillScopeTarget => ({
  scope: ESkillScope.Group,
  groupId,
})

export const skillsDescriptionOf = (target: SkillScopeTarget): string => {
  if (target.scope === ESkillScope.Project) {
    return 'Skills stored for this project, loaded in threads on this project.'
  }
  if (target.scope === ESkillScope.Group) {
    return 'Skills stored for this group, loaded in every project in it.'
  }
  return 'Your personal skills, loaded in every thread on every project.'
}
