import {
  deliveredDraft,
  ENoticeStage,
  noticeIdOf,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

export type PrEventAck = (args: { threadId: ThreadId; eventIds: string[] }) => void

export const prEventNoticeIdOf = (eventId: string): string => `pr-event:${eventId}`

type PrEventDraft = Extract<EventDraft, { type: 'pr-event' }>

const asPrEvent = (draft: EventDraft): PrEventDraft | undefined =>
  draft.type === 'pr-event' ? draft : undefined

const eventIdOf = (draft: EventDraft): string | undefined => asPrEvent(draft)?.eventId

export const isUnstampedPrEvent = (draft: EventDraft): boolean =>
  draft.type === 'pr-event' && draft.eventId !== undefined && draft.notice === undefined

/**
 * A pr-event that carries a mailbox event id joins the owed-notice stage: stamped `arrived` when
 * the registry journals it, `delivered` once the intake queue hands it to a model boundary.
 */
export const stampArrival = (draft: EventDraft): EventDraft => {
  const prEvent = asPrEvent(draft)
  if (prEvent?.eventId === undefined) return draft
  const stamped: PrEventDraft = {
    ...prEvent,
    notice: { id: prEventNoticeIdOf(prEvent.eventId), stage: ENoticeStage.Arrived },
  }
  return stamped
}

export const deliveredForm = (arrived: EventDraft): EventDraft => {
  const id = noticeIdOf(arrived)
  return id === undefined ? arrived : deliveredDraft({ draft: arrived, id })
}

export function collectAckableEventIds(drafts: readonly EventDraft[]): {
  eventIds: string[]
  unstamped: string[]
} {
  const eventIds: string[] = []
  const unstamped: string[] = []
  for (const draft of drafts) {
    const prEvent = asPrEvent(draft)
    if (prEvent?.eventId === undefined) continue
    if (prEvent.notice === undefined) unstamped.push(prEvent.eventId)
    else eventIds.push(prEvent.eventId)
  }
  return { eventIds, unstamped }
}
