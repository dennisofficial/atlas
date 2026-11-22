import { EDefinitionOrigin } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { skillSpecOf } from '@dltech/atlas-plugin-skills/core'
import { BUILT_IN_SKILL_SPECS } from '@dltech/atlas-plugin-skills/pod'
import type { SkillCatalogueEntry } from '@dltech/atlas-wire'
import { Injectable } from '@nestjs/common'
import { mergeSkills, originated, type OriginatedSkill } from './skill-catalogue.merge'

const SKILL_ENTRY = 'SKILL.md'

const entryOf = (args: { text: string; fallbackName: string }): SkillCatalogueEntry | undefined => {
  const parsed = skillSpecOf(args)
  if (parsed === undefined || !parsed.userInvocable) return undefined
  const { name, summary, argumentHint } = parsed
  return argumentHint === undefined ? { name, summary } : { name, summary, argumentHint }
}

@Injectable()
export class SkillCatalogueService {
  async list(args: { userId: string }): Promise<SkillCatalogueEntry[]> {
    const user = await this.userSkills(args.userId)
    const builtIn = BUILT_IN_SKILL_SPECS.map((spec) =>
      originated({
        origin: EDefinitionOrigin.BuiltIn,
        spec: {
          name: spec.name,
          summary: spec.summary,
          ...(spec.argumentHint === undefined ? {} : { argumentHint: spec.argumentHint }),
        },
      }),
    )
    return mergeSkills([...builtIn, ...user])
  }

  private async userSkills(userId: string): Promise<OriginatedSkill[]> {
    const skills = await db.orm.public.Skill.where({ userId })
      .orderBy((skill) => skill.name.asc())
      .all()
    if (skills.length === 0) return []
    const entries = await db.orm.public.SkillFile.where((file) =>
      file.skillId.in(skills.map((skill) => skill.id)),
    )
      .where((file) => file.path.ilike(SKILL_ENTRY))
      .all()
    const nameOf = new Map(skills.map((skill) => [skill.id, skill.name]))
    return entries.flatMap((file) => {
      const text = Buffer.from(file.content).toString('utf8')
      const entry = entryOf({ text, fallbackName: nameOf.get(file.skillId) ?? '' })
      return entry === undefined
        ? []
        : [originated({ origin: EDefinitionOrigin.User, spec: entry })]
    })
  }
}
