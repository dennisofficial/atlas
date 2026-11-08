import type { V2Event } from '@dltech/atlas-core'
import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'

export type RewindApi = {
  command(input: SessionCommandInput): Promise<SessionCommandOutput>
}

export type PendingRewind = { inboxId: number; eventId: string; text: string }

export enum ERewindOutcome {
  Waiting = 'waiting',
  Refused = 'refused',
  Applied = 'applied',
}

export type RewindOutcome =
  | { kind: ERewindOutcome.Waiting }
  | { kind: ERewindOutcome.Refused; reason: string }
  | { kind: ERewindOutcome.Applied; draft: string }

export const seqByEventIdOf = (events: readonly V2Event[]): ReadonlyMap<string, number> =>
  new Map(events.flatMap((event) => (event.type === 'user-said' ? [[event.id, event.seq]] : [])))

export const rewindOutcomeOf = ({
  events,
  pending,
}: {
  events: readonly V2Event[]
  pending: PendingRewind
}): RewindOutcome => {
  const refused = events.find(
    (event) => event.type === 'input-refused' && event.inboxId === pending.inboxId,
  )
  if (refused?.type === 'input-refused') {
    return { kind: ERewindOutcome.Refused, reason: refused.reason }
  }
  if (events.some((event) => event.id === pending.eventId)) return { kind: ERewindOutcome.Waiting }
  return { kind: ERewindOutcome.Applied, draft: pending.text }
}

export const requestRewind = async ({
  api,
  sessionId,
  toSeq,
  eventId,
  text,
}: {
  api: RewindApi
  sessionId: string
  toSeq: number
  eventId: string
  text: string
}): Promise<PendingRewind> => {
  const { inboxId } = await api.command({ sessionId, name: 'rewind', args: { toSeq } })
  if (inboxId === undefined) throw new Error('rewind was not queued')
  return { inboxId, eventId, text }
}

export const rewoundDraftOf = (events: readonly V2Event[]): string | undefined => {
  const last = events.at(-1)
  return last?.type === 'history-rewound' ? last.draft : undefined
}
