import type { SkillFileMeta } from '@dltech/atlas-wire/web'

export function defaultSkillPath({ metas }: { metas: SkillFileMeta[] }): string | null {
  if (metas.length === 0) return null
  const skillMd = metas.find((meta) => meta.path === 'SKILL.md')
  if (skillMd !== undefined) return skillMd.path
  const firstText = metas.find((meta) => meta.isText)
  return firstText?.path ?? metas[0]?.path ?? null
}
