export type SubscriptionEventSpec = {
  name: string
  summary: string
  alwaysDelivered?: boolean
}

export type SubscriptionEventCatalog = readonly SubscriptionEventSpec[]

export type EventFilterResolution =
  | { ok: true; events: readonly string[] }
  | { ok: false; error: string }

const alwaysDeliveredOf = (catalog: SubscriptionEventCatalog): readonly string[] =>
  catalog.filter((spec) => spec.alwaysDelivered === true).map((spec) => spec.name)

export const catalogText = (catalog: SubscriptionEventCatalog): string => {
  if (catalog.length === 0) return ''
  const named = catalog.map((spec) => spec.name).join(', ')
  const always = alwaysDeliveredOf(catalog)
  return always.length === 0 ? named : `${named} (${always.join(' and ')} always delivered)`
}

export const filterLabelSuffix = (events: readonly string[]): string => {
  const unique = [...new Set(events)].sort()
  return unique.length === 0 ? '' : ` (only: ${unique.join(', ')})`
}

export const resolveEventFilter = (args: {
  catalog: SubscriptionEventCatalog
  requested?: readonly string[] | undefined
  provider?: string | undefined
}): EventFilterResolution => {
  if (args.requested === undefined || args.requested.length === 0) return { ok: true, events: [] }
  const requested = [...new Set(args.requested)]
  const known = new Set(args.catalog.map((spec) => spec.name))
  if (known.size === 0) {
    return {
      ok: false,
      error: `${args.provider ?? 'This provider'} has no event filter; it delivers every occurrence.`,
    }
  }
  const unknown = requested.filter((name) => !known.has(name)).sort()
  if (unknown.length > 0) {
    const listed = unknown.map((name) => `"${name}"`).join(', ')
    const valid = [...known].sort().join(', ')
    return { ok: false, error: `Unknown event ${listed}. Valid events: ${valid}.` }
  }
  return { ok: true, events: requested.sort() }
}

export const deliversEvent = (args: {
  catalog: SubscriptionEventCatalog
  events: readonly string[]
  name: string
}): boolean => {
  if (args.events.length === 0) return true
  if (args.events.includes(args.name)) return true
  return args.catalog.some((spec) => spec.name === args.name && spec.alwaysDelivered === true)
}
