import type { PendingInput, PendingInputsState, V2Event } from '@dltech/atlas-core'

import {
  EOutgoingPlacement,
  EStagedOutcome,
  stagedOutcomesOf,
  type StagedInput,
} from './outgoing-messages'

export type PlacedStaged = StagedInput & { placement: EOutgoingPlacement }

export type OptimisticPlacement<TStaged extends PlacedStaged> = {
  transcript: TStaged[]
  queue: TStaged[]
  hiddenInboxIds: ReadonlySet<number>
}

const clientIdByInboxOf = (events: readonly V2Event[]): ReadonlyMap<number, string> =>
  new Map(
    events.flatMap((event) =>
      event.type === 'input-posted' && event.message?.clientId !== undefined
        ? [[event.inboxId, event.message.clientId] as const]
        : [],
    ),
  )

const saidClientIdsOf = (events: readonly V2Event[]): ReadonlySet<string> => {
  const byInbox = clientIdByInboxOf(events)
  return new Set(
    events.flatMap((event) => {
      if (event.type !== 'user-said') return []
      const clientId =
        event.clientId ?? (event.inboxId === undefined ? undefined : byInbox.get(event.inboxId))
      return clientId === undefined ? [] : [clientId]
    }),
  )
}

const openTurnStartedSeqOf = (events: readonly V2Event[]): number | undefined => {
  let started: number | undefined
  for (const event of events) {
    if (event.type === 'turn-started') started = event.seq
    else if (event.type === 'turn-ended') started = undefined
  }
  return started
}

const pendingByClientIdOf = (pending: PendingInputsState): ReadonlyMap<string, PendingInput> =>
  new Map(
    pending.pending.flatMap((input) =>
      input.message?.clientId === undefined ? [] : [[input.message.clientId, input] as const],
    ),
  )

export const optimisticPlacementOf = <TStaged extends PlacedStaged>(args: {
  staged: readonly TStaged[]
  events: readonly V2Event[]
  pending: PendingInputsState
}): OptimisticPlacement<TStaged> => {
  const outcomes = stagedOutcomesOf({
    events: args.events,
    clientIds: args.staged.map((entry) => entry.clientId),
  })
  const said = saidClientIdsOf(args.events)
  const pendingByClientId = pendingByClientIdOf(args.pending)
  const openTurnStartedSeq = openTurnStartedSeqOf(args.events)
  const transcript: TStaged[] = []
  const queue: TStaged[] = []
  const hiddenInboxIds = new Set<number>()
  for (const entry of args.staged) {
    if (said.has(entry.clientId)) continue
    const outcome = outcomes.get(entry.clientId)?.outcome ?? EStagedOutcome.Pending
    if (outcome === EStagedOutcome.Withdrawn || outcome === EStagedOutcome.Refused) continue
    const pendingInput = pendingByClientId.get(entry.clientId)
    if (pendingInput !== undefined) {
      const behindOtherTurn =
        openTurnStartedSeq !== undefined && openTurnStartedSeq < pendingInput.seq
      if (entry.placement === EOutgoingPlacement.Transcript && !behindOtherTurn) {
        transcript.push(entry)
        hiddenInboxIds.add(pendingInput.inboxId)
      }
      continue
    }
    if (outcome !== EStagedOutcome.Pending) continue
    if (entry.placement === EOutgoingPlacement.Transcript) transcript.push(entry)
    else queue.push(entry)
  }
  return { transcript, queue, hiddenInboxIds }
}
