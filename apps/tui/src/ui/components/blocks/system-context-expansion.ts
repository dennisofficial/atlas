import type { SystemContextEntry } from '../../../store/transcript-model'

export const injectionKey = (id: string): string => `injection:${id}`

export type OpenedInjections = WeakMap<SystemContextEntry, ReadonlySet<string>>

export const openedInjectionsOf = (args: {
  cache: OpenedInjections
  entry: SystemContextEntry
  opened: ReadonlySet<string>
}): ReadonlySet<string> => {
  const keys = [args.entry.key, ...args.entry.items.map((item) => injectionKey(item.key))]
  const next = new Set(keys.filter((key) => args.opened.has(key)))
  const held = args.cache.get(args.entry)
  if (held !== undefined && held.size === next.size && [...next].every((key) => held.has(key))) {
    return held
  }

  args.cache.set(args.entry, next)
  return next
}
