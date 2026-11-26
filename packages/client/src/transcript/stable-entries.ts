import type { TranscriptEntry } from './transcript-model'
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function sameShape(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!isRecord(left) || !isRecord(right)) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false

  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false

  return keys.every((key) => key in right && sameShape(left[key], right[key]))
}

/** Carries unchanged items onto their previous identity, so `React.memo` on a row can hold. */
export function stabilisedBy<T>(args: {
  previous: readonly T[]
  next: readonly T[]
  keyOf: (item: T) => string
}): readonly T[] {
  const { previous, next, keyOf } = args
  const held = new Map(previous.map((item) => [keyOf(item), item]))

  const settled = next.map((item) => {
    const before = held.get(keyOf(item))
    return before !== undefined && sameShape(before, item) ? before : item
  })

  const unchanged =
    settled.length === previous.length && settled.every((item, index) => item === previous[index])

  return unchanged ? previous : settled
}

/** Carries unchanged transcript entries onto their previous identity, so a row's `memo` can hold. */
export function stabilisedEntries(args: {
  previous: readonly TranscriptEntry[]
  next: readonly TranscriptEntry[]
}): readonly TranscriptEntry[] {
  return stabilisedBy({ ...args, keyOf: (entry) => entry.key })
}
