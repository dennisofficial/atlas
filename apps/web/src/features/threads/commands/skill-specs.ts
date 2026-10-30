import { ECommandGroup, ECommandKind, type CommandSpec } from '@dltech/atlas-core'
import type { CommandSkillWire } from '@dltech/atlas-wire/web'

export const skillSpecOf = (skill: CommandSkillWire): CommandSpec => ({
  name: skill.name,
  aliases: skill.aliases,
  kind: ECommandKind.Skill,
  summary: skill.summary,
  group: ECommandGroup.Workspace,
  argumentHint: skill.argumentHint,
})

export const mergeSkillSpecs = (args: {
  catalogue: readonly CommandSpec[]
  sandbox: readonly CommandSpec[]
}): readonly CommandSpec[] => {
  const sandboxNames = new Set(args.sandbox.map((spec) => spec.name))
  return [...args.catalogue.filter((spec) => !sandboxNames.has(spec.name)), ...args.sandbox]
}

export const skillCountNotice = (count: number): string =>
  count === 1 ? '1 skill' : `${count} skills`
