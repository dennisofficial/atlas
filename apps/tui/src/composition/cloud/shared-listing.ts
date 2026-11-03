export const LISTING_FRESH_FOR_MS = 5_000

type Held<T> = { value: Promise<T>; settledAtMs: number | undefined }

export function sharedListing<TArgs, T>(args: {
  list: (listArgs: TArgs) => Promise<T>
  keyOf: (listArgs: TArgs) => string
  freshForMs?: number | undefined
  nowMs?: (() => number) | undefined
}): (listArgs: TArgs) => Promise<T> {
  const freshForMs = args.freshForMs ?? LISTING_FRESH_FOR_MS
  const nowMs = args.nowMs ?? Date.now
  const held = new Map<string, Held<T>>()

  const isUsable = (entry: Held<T>): boolean =>
    entry.settledAtMs === undefined || nowMs() - entry.settledAtMs < freshForMs

  return (listArgs) => {
    const key = args.keyOf(listArgs)
    const existing = held.get(key)
    if (existing !== undefined && isUsable(existing)) return existing.value

    const entry: Held<T> = { value: args.list(listArgs), settledAtMs: undefined }
    held.set(key, entry)
    entry.value.then(
      () => {
        entry.settledAtMs = nowMs()
      },
      () => {
        if (held.get(key) === entry) held.delete(key)
      },
    )
    return entry.value
  }
}
