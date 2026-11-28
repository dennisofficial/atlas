import {
  groupSkillTarget,
  personalSkillTarget,
  projectSkillTarget,
  type SkillScopeTarget,
} from '@dltech/atlas-client/settings'
import { ESkillScope } from '@dltech/atlas-wire/web'
import { ESkillFileAction } from './skill-file-actions'

export type SkillFileFormParams = {
  scope?: string
  projectId?: string
  groupId?: string
  skillId?: string
  action?: string
  path?: string
  folder?: string
}

export const skillFileFormInputOf = (params: SkillFileFormParams) => {
  let target: SkillScopeTarget = personalSkillTarget
  if (params.scope === ESkillScope.Project) {
    if (!params.projectId) return null
    target = projectSkillTarget({ projectId: params.projectId })
  } else if (params.scope === ESkillScope.Group) {
    if (!params.groupId) return null
    target = groupSkillTarget({ groupId: params.groupId })
  } else if (params.scope !== ESkillScope.Personal) return null
  const action = Object.values(ESkillFileAction).find((value) => value === params.action)
  if (!params.skillId || !action || action === ESkillFileAction.Delete) return null
  const path = params.path ?? ''
  const folder = params.folder === 'true'
  if (action === ESkillFileAction.Rename && path === '') return null
  const basePath =
    action === ESkillFileAction.Rename ? path.split('/').slice(0, -1).join('/') : folder ? path : ''
  return {
    target: { ...target, skill: params.skillId },
    action,
    path,
    folder,
    basePath,
    replacing: action === ESkillFileAction.Upload && path !== '' && !folder,
  }
}
