import { ESkillOrigin, type SkillWarning } from './spec'

const SHADOWING_RANK: Readonly<Record<ESkillOrigin, number>> = {
  [ESkillOrigin.BuiltIn]: 0,
  [ESkillOrigin.CloudUser]: 1,
  [ESkillOrigin.CloudProject]: 2,
  [ESkillOrigin.Repo]: 3,
}

export type OriginatedSkill = {
  readonly name: string
  readonly origin: ESkillOrigin
  readonly warnings: readonly SkillWarning[]
}

export type ShadowedSkill<TSkill extends OriginatedSkill> = {
  shadowed: TSkill
  by: TSkill
}

export type ResolvedSkills<TSkill extends OriginatedSkill> = {
  kept: readonly TSkill[]
  shadowed: readonly ShadowedSkill<TSkill>[]
}

const byName = (left: OriginatedSkill, right: OriginatedSkill): number =>
  left.name < right.name ? -1 : left.name > right.name ? 1 : 0

export function resolveSkillShadowing<TSkill extends OriginatedSkill>(
  skills: readonly TSkill[],
): ResolvedSkills<TSkill> {
  const winners = new Map<string, TSkill>()
  const shadowed: ShadowedSkill<TSkill>[] = []

  for (const skill of skills) {
    const held = winners.get(skill.name)
    if (held === undefined) {
      winners.set(skill.name, skill)
      continue
    }
    if (SHADOWING_RANK[held.origin] >= SHADOWING_RANK[skill.origin]) {
      shadowed.push({ shadowed: skill, by: held })
      continue
    }
    shadowed.push({ shadowed: held, by: skill })
    winners.set(skill.name, skill)
  }

  return {
    kept: [...winners.values()].sort(byName),
    shadowed: shadowed.sort((left, right) => byName(left.shadowed, right.shadowed)),
  }
}
