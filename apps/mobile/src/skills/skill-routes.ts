import { groupSkillTarget, type SkillScopeTarget } from '@dltech/atlas-client/settings'
import { EConfigLayer } from '@dltech/atlas-core'
import type { ConfigLayerOwner } from '@dltech/atlas-wire/web'
import type { Href } from 'expo-router'

export const skillsRouteOf = (target: SkillScopeTarget): Href => {
  if (target.projectId !== undefined) {
    return `/project-settings/${encodeURIComponent(target.projectId)}/skills`
  }
  if (target.groupId !== undefined) {
    return `/group-settings/${encodeURIComponent(target.groupId)}/skills`
  }
  return '/settings/skills'
}

export const groupSkillsRouteOf = ({ groupId }: { groupId: string }): Href =>
  skillsRouteOf(groupSkillTarget({ groupId }))

export const newSkillRouteOf = (target: SkillScopeTarget): Href => {
  if (target.projectId !== undefined) {
    return `/project-settings/${encodeURIComponent(target.projectId)}/skills-new`
  }
  if (target.groupId !== undefined) {
    return `/group-settings/${encodeURIComponent(target.groupId)}/skills-new`
  }
  return '/settings/skills-new'
}

export const layerSkillsRouteOf = ({
  layer,
  owner,
}: {
  layer: EConfigLayer
  owner: ConfigLayerOwner
}): Href | null => {
  if (layer === EConfigLayer.Personal) return '/settings/skills'
  if (layer === EConfigLayer.Group && owner.id !== null) {
    return groupSkillsRouteOf({ groupId: owner.id })
  }
  return null
}
