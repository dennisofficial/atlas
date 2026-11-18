import type { Attachment } from '../attachments/attachment'
import type { V2Event } from './event'
import { isMessageInputKind } from './input-events'

export type PendingInput = {
  inboxId: number
  seq: number
  at: string
  kind: string
  clientId?: string | undefined
  text?: string | undefined
  attachments?: readonly Attachment[] | undefined
}

export type PendingInputsState = { pending: readonly PendingInput[] }

export const EMPTY_PENDING: PendingInputsState = { pending: [] }

const withoutInbox = (
  state: PendingInputsState,
  inboxId: number | undefined,
): PendingInputsState => {
  if (inboxId === undefined) return state
  if (!state.pending.some((entry) => entry.inboxId === inboxId)) return state
  return { pending: state.pending.filter((entry) => entry.inboxId !== inboxId) }
}

const postedEntry = (event: Extract<V2Event, { type: 'input-posted' }>): PendingInput => ({
  inboxId: event.inboxId,
  seq: event.seq,
  at: event.postedAt,
  kind: event.kind,
  ...(event.clientId === undefined ? {} : { clientId: event.clientId }),
  ...(event.text === undefined ? {} : { text: event.text }),
  ...(event.attachments === undefined ? {} : { attachments: event.attachments }),
})

const withPosted = (
  state: PendingInputsState,
  event: Extract<V2Event, { type: 'input-posted' }>,
): PendingInputsState => {
  if (state.pending.some((entry) => entry.inboxId === event.inboxId)) return state
  const entry = postedEntry(event)
  const at = state.pending.findIndex((kept) => kept.seq > event.seq)
  if (at < 0) return { pending: [...state.pending, entry] }
  return { pending: [...state.pending.slice(0, at), entry, ...state.pending.slice(at)] }
}

export function stepPending(state: PendingInputsState, event: V2Event): PendingInputsState {
  switch (event.type) {
    case 'input-posted':
      return withPosted(state, event)
    case 'input-withdrawn':
    case 'input-consumed':
      return withoutInbox(state, event.inboxId)
    case 'input-refused':
      return withoutInbox(withoutInbox(state, event.inboxId), event.targetInboxId)
    case 'user-said':
      return withoutInbox(state, event.inboxId)
    default:
      return state
  }
}

export const pendingInputsOf = (events: readonly V2Event[]): PendingInputsState =>
  events.reduce(stepPending, EMPTY_PENDING)

export const pendingMessagesOf = (state: PendingInputsState): readonly PendingInput[] =>
  state.pending.filter((entry) => isMessageInputKind(entry.kind))

export const queuedSinceOf = (state: PendingInputsState): string | null =>
  pendingMessagesOf(state)[0]?.at ?? null
