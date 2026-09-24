import { MAX_INDEX_BYTES, MAX_INDEX_LINES } from './index-file'

/**
 * The fraction of either cap at which the index stops being trimmed-entry territory and starts
 * being reconcile territory. Below it a healthy index never trips; above it there is still room
 * to reconcile before the hard cap truncates and silently drops the tail.
 */
export const RECONCILE_THRESHOLD = 0.8

export type MemoryIndexSize = {
  lines: number
  bytes: number
}

export function indexNearsBound(size: MemoryIndexSize): boolean {
  return (
    size.lines >= MAX_INDEX_LINES * RECONCILE_THRESHOLD ||
    size.bytes >= MAX_INDEX_BYTES * RECONCILE_THRESHOLD
  )
}

const percentOf = (args: { value: number; cap: number }): number =>
  Math.round((args.value / args.cap) * 100)

/**
 * The reconcile instruction, injected as a system-reminder when an index crosses the threshold.
 * It asks for the reconcile pass — cull, merge, delete — explicitly, because the cap warning
 * alone reads as "shorten one entry," which only resets the treadmill for the next session.
 */
export function reconcileNudgeText(args: { directory: string; size: MemoryIndexSize }): string {
  const lines = percentOf({ value: args.size.lines, cap: MAX_INDEX_LINES })
  const bytes = percentOf({ value: args.size.bytes, cap: MAX_INDEX_BYTES })

  return [
    `The memory index at ${args.directory} is near its load limit (${args.size.lines} lines = ${lines}% of ${MAX_INDEX_LINES}, ${args.size.bytes} bytes = ${bytes}% of ${MAX_INDEX_BYTES}). Past the limit the tail is silently truncated.`,
    '',
    'Do not fix this by shortening one entry — the next session will cross the line again. Reconcile instead:',
    '',
    '- Drop entries for work that has since shipped or merged, and for claims that are no longer true; delete their files.',
    '- Fold overlapping memories on the same subject into one file — a memory you have learned more about supersedes its predecessor, it does not sit beside it.',
    '- Only then tighten the hooks of what remains, keeping each to one line.',
    '',
    'Do this when the session is not mid-task on something else, or tell the developer it is due.',
  ].join('\n')
}
