import { commandInputKind, type InboxEntry, type V2Event } from '@dltech/atlas-core'

export const INBOX_KIND_REWIND = commandInputKind('rewind')

const toSeqOf = (entry: InboxEntry): number | undefined => {
  if (entry.kind !== INBOX_KIND_REWIND) return undefined
  try {
    const parsed: unknown = JSON.parse(entry.payload)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const toSeq = (parsed as { toSeq?: unknown }).toSeq
    return typeof toSeq === 'number' && Number.isInteger(toSeq) && toSeq >= 1 ? toSeq : undefined
  } catch {
    return undefined
  }
}

const appliedTargetsOf = (events: readonly V2Event[]): ReadonlySet<number> =>
  new Set(events.flatMap((event) => (event.type === 'history-rewound' ? [event.toSeq + 1] : [])))

/**
 * A rewind that a later rewind to the same message has overtaken, or that has already been
 * applied, is dropped rather than run: running it again would only refuse "Only one of your
 * messages can be rewound to" at the operator.
 */
export const supersededRewindIdsOf = (args: {
  entries: readonly InboxEntry[]
  events: readonly V2Event[]
}): ReadonlySet<number> => {
  const applied = appliedTargetsOf(args.events)
  const rewinds = args.entries.filter((entry) => toSeqOf(entry) !== undefined)
  const latestByTarget = new Map<number, number>()
  for (const entry of rewinds) {
    const toSeq = toSeqOf(entry)
    if (toSeq === undefined) continue
    latestByTarget.set(toSeq, Math.max(latestByTarget.get(toSeq) ?? 0, entry.inboxId))
  }
  const dropped = new Set<number>()
  for (const entry of rewinds) {
    const toSeq = toSeqOf(entry)
    if (toSeq === undefined) continue
    if (latestByTarget.get(toSeq) !== entry.inboxId || applied.has(toSeq)) {
      dropped.add(entry.inboxId)
    }
  }
  return dropped
}
