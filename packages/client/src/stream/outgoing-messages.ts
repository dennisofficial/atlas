import { EInputConsumed, type RecordEvent } from '@dltech/atlas-core'

export enum EOutgoingPlacement {
  Queue = 'queue',
  Transcript = 'transcript',
}

export enum EStagedOutcome {
  Pending = 'pending',
  Posted = 'posted',
  Refused = 'refused',
  Withdrawn = 'withdrawn',
  Discarded = 'discarded',
}

export const ALREADY_SENT_REASON = 'already-sent'

export type StagedInput = { clientId: string }

export type StagedOutcome = {
  clientId: string
  outcome: EStagedOutcome
  reason?: string | undefined
  text?: string | undefined
}

export type StagedSplit<TStaged extends StagedInput> = {
  queue: TStaged[]
  transcript: TStaged[]
}

const clientIdByInbox = (events: readonly RecordEvent[]): ReadonlyMap<number, string> =>
  new Map(
    events.flatMap((event) =>
      event.type === 'input-posted' && event.message?.clientId !== undefined
        ? [[event.inboxId, event.message.clientId] as const]
        : [],
    ),
  )

type EventOutcome = {
  clientId: string
  outcome: EStagedOutcome
  reason?: string | undefined
  text?: string | undefined
}

const outcomeOf = (args: {
  event: RecordEvent
  byInbox: ReadonlyMap<number, string>
}): EventOutcome | undefined => {
  const { event, byInbox } = args
  switch (event.type) {
    case 'input-posted': {
      const clientId = event.message?.clientId
      if (clientId === undefined) return undefined
      return { clientId, outcome: EStagedOutcome.Posted }
    }
    case 'user-said': {
      const clientId = event.clientId ?? byInbox.get(event.inboxId ?? 0)
      if (clientId === undefined) return undefined
      return { clientId, outcome: EStagedOutcome.Posted }
    }
    case 'input-consumed': {
      const clientId = byInbox.get(event.inboxId)
      if (clientId === undefined) return undefined
      if (event.consumed === EInputConsumed.Discarded) {
        return { clientId, outcome: EStagedOutcome.Discarded }
      }
      return { clientId, outcome: EStagedOutcome.Posted }
    }
    case 'input-withdrawn': {
      const clientId = byInbox.get(event.inboxId)
      if (clientId === undefined) return undefined
      return { clientId, outcome: EStagedOutcome.Withdrawn }
    }
    case 'input-refused': {
      const clientId =
        event.clientId ??
        (event.targetInboxId === undefined ? undefined : byInbox.get(event.targetInboxId)) ??
        byInbox.get(event.inboxId)
      if (clientId === undefined) return undefined
      const text = event.message?.text ?? event.text
      return {
        clientId,
        outcome: EStagedOutcome.Refused,
        reason: event.reason,
        ...(text === undefined ? {} : { text }),
      }
    }
    default:
      return undefined
  }
}

export const stagedOutcomesOf = (args: {
  events: readonly RecordEvent[]
  clientIds: readonly string[]
}): ReadonlyMap<string, StagedOutcome> => {
  const byInbox = clientIdByInbox(args.events)
  const outcomes = new Map<string, StagedOutcome>()
  for (const event of args.events) {
    const resolved = outcomeOf({ event, byInbox })
    if (resolved === undefined) continue
    outcomes.set(resolved.clientId, resolved)
  }
  const wanted = new Set(args.clientIds)
  return new Map([...outcomes].filter(([clientId]) => wanted.has(clientId)))
}

export const placementOf = (args: { working: boolean }): EOutgoingPlacement =>
  args.working ? EOutgoingPlacement.Queue : EOutgoingPlacement.Transcript

export const stagedWithdrawOwnedIdsOf = (args: {
  events: readonly RecordEvent[]
  clientIds: readonly string[]
  ownedInboxIds: ReadonlySet<number>
}): ReadonlySet<string> => {
  const wanted = new Set(args.clientIds)
  const owned = new Set<string>()
  for (const [inboxId, clientId] of clientIdByInbox(args.events)) {
    if (args.ownedInboxIds.has(inboxId) && wanted.has(clientId)) owned.add(clientId)
  }
  return owned
}

export const pendingStagedOf = <TStaged extends StagedInput>(args: {
  staged: readonly TStaged[]
  events: readonly RecordEvent[]
}): TStaged[] => {
  const outcomes = stagedOutcomesOf({
    events: args.events,
    clientIds: args.staged.map((entry) => entry.clientId),
  })
  return args.staged.filter(
    (entry) =>
      (outcomes.get(entry.clientId)?.outcome ?? EStagedOutcome.Pending) === EStagedOutcome.Pending,
  )
}

export const stagedPlacementOf = <TStaged extends StagedInput>(args: {
  staged: readonly TStaged[]
  events: readonly RecordEvent[]
  working: boolean
}): StagedSplit<TStaged> => {
  const pending = pendingStagedOf({ staged: args.staged, events: args.events })
  return placementOf({ working: args.working }) === EOutgoingPlacement.Queue
    ? { queue: pending, transcript: [] }
    : { queue: [], transcript: pending }
}

export type RestorableStaged<TStaged extends StagedInput> = {
  staged: TStaged
  reason: string | undefined
}

export const restorableStagedOf = <TStaged extends StagedInput>(args: {
  staged: readonly TStaged[]
  events: readonly RecordEvent[]
}): RestorableStaged<TStaged>[] => {
  const outcomes = stagedOutcomesOf({
    events: args.events,
    clientIds: args.staged.map((entry) => entry.clientId),
  })
  return args.staged.flatMap((entry) => {
    const settled = outcomes.get(entry.clientId)
    if (settled === undefined) return []
    if (settled.outcome === EStagedOutcome.Posted) return []
    if (settled.reason === ALREADY_SENT_REASON) return []
    return [{ staged: entry, reason: settled.reason }]
  })
}
