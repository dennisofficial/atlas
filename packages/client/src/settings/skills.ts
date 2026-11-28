import { EConfigLayer } from '@dltech/atlas-core'
import { ESkillScope } from '@dltech/atlas-wire/web'
import type {
  SkillLayer,
  SkillScopeInput,
  SkillSummary,
  SkillUsageReply,
} from '@dltech/atlas-wire/web'

export function skillUsageKeyOf(target: SkillScopeInput): string {
  return `skill-usage:${target.scope}:${target.projectId ?? target.groupId ?? ''}`
}

export function skillUsageTargetOf(layer: SkillLayer): SkillScopeInput | undefined {
  if (layer.layer === EConfigLayer.BuiltIn || layer.layer === EConfigLayer.Personal) {
    return { scope: ESkillScope.Personal }
  }
  if (layer.owner.id === null) return undefined
  if (layer.layer === EConfigLayer.Group) {
    return { scope: ESkillScope.Group, groupId: layer.owner.id }
  }
  if (layer.layer === EConfigLayer.Project) {
    return { scope: ESkillScope.Project, projectId: layer.owner.id }
  }
  return undefined
}

export function withSkillUsage<T extends SkillSummary>(args: {
  skills: readonly T[]
  usage: SkillUsageReply['usage'] | undefined
}): T[] {
  return args.skills.map((skill) => {
    const usage = args.usage?.[skill.name]
    return usage === undefined ? skill : { ...skill, usage, usagePending: false }
  })
}
