import { proseLinesOf } from '../compaction/render-range'
import type { Event } from '../events/envelope'

export const SESSION_EXCERPT_CHARACTER_LIMIT = 6_000

export const SESSION_EXCERPT_GAP = '…'

const recentLinesWithin = (args: { lines: readonly string[]; budget: number }): string[] => {
  const kept: string[] = []
  let left = args.budget
  for (let index = args.lines.length - 1; index >= 0; index -= 1) {
    const line = args.lines[index]
    if (line === undefined || line.length + 1 > left) break
    kept.unshift(line)
    left -= line.length + 1
  }
  return kept
}

export function sessionExcerptOf(args: {
  events: readonly Event[]
  limit?: number | undefined
}): string {
  const [opening, ...rest] = proseLinesOf(args.events)
  if (opening === undefined) return ''
  const limit = args.limit ?? SESSION_EXCERPT_CHARACTER_LIMIT
  const recent = recentLinesWithin({ lines: rest, budget: limit - opening.length })
  const skipped = rest.length > recent.length
  return [opening, ...(skipped ? [SESSION_EXCERPT_GAP] : []), ...recent].join('\n')
}
