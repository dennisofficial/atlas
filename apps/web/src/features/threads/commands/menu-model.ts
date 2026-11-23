import { ECommandGroup, type CommandEntry } from '@dltech/atlas-commands'
import { activeQuery } from '@dltech/atlas-core'

const GROUP_ORDER: readonly ECommandGroup[] = Object.values(ECommandGroup)
const SEGMENT_BREAK = /[:\-_]/

const matches = (args: { name: string; query: string }): boolean => {
  const lowered = args.name.toLowerCase()
  if (lowered.startsWith(args.query)) return true
  return lowered.split(SEGMENT_BREAK).some((segment) => segment.startsWith(args.query))
}

export const groupedCandidates = (args: {
  text: string
  entries: readonly CommandEntry[]
}): readonly CommandEntry[] => {
  const query = activeQuery(args.text)
  if (query === null) return []
  const lowered = query.toLowerCase()
  return GROUP_ORDER.flatMap((group) =>
    args.entries.filter(
      (entry) => entry.group === group && matches({ name: entry.name, query: lowered }),
    ),
  )
}

export const completedText = (args: { text: string; name: string }): string => {
  const query = activeQuery(args.text) ?? ''
  return `${args.text.slice(0, args.text.length - query.length)}${args.name} `
}

export const steppedIndex = (args: { index: number; delta: number; length: number }): number =>
  args.length === 0 ? 0 : (args.index + args.delta + args.length) % args.length
