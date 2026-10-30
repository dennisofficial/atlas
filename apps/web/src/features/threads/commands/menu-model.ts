import { ECommandGroup, activeQuery, commandCandidates, type CommandSpec } from '@dltech/atlas-core'

const GROUP_ORDER: readonly ECommandGroup[] = Object.values(ECommandGroup)

export const groupedCandidates = (args: {
  text: string
  specs: readonly CommandSpec[]
}): readonly CommandSpec[] => {
  const found = commandCandidates(args)
  return GROUP_ORDER.flatMap((group) => found.filter((spec) => spec.group === group))
}

export const completedText = (args: { text: string; name: string }): string => {
  const query = activeQuery(args.text) ?? ''
  return `${args.text.slice(0, args.text.length - query.length)}${args.name} `
}

export const steppedIndex = (args: { index: number; delta: number; length: number }): number =>
  args.length === 0 ? 0 : (args.index + args.delta + args.length) % args.length
