import type { EventDraft } from './body'
import type { Event } from './envelope'

export enum ENoticeStage {
  Arrived = 'arrived',
  Delivered = 'delivered',
}

export type NoticeStamp = { id: string; stage: ENoticeStage }

const noticeOf = (event: EventDraft): NoticeStamp | undefined => {
  switch (event.type) {
    case 'agent-ended':
    case 'agent-reported':
    case 'service-ended':
    case 'background-shell-ended':
    case 'background-shell-matched':
    case 'background-shell-awaiting-input':
    case 'pr-event':
      return event.notice
    default:
      return undefined
  }
}

const withNotice = ({ draft, notice }: { draft: EventDraft; notice: NoticeStamp }): EventDraft => {
  switch (draft.type) {
    case 'agent-ended':
    case 'agent-reported':
    case 'service-ended':
    case 'background-shell-ended':
    case 'background-shell-matched':
    case 'background-shell-awaiting-input':
    case 'pr-event':
      return { ...draft, notice }
    default:
      return draft
  }
}

const isBookkeepingEnding = (event: EventDraft): boolean =>
  event.type === 'agent-ended' && event.relayed === false

export const isNoticeArrival = (event: EventDraft): boolean =>
  noticeOf(event)?.stage === ENoticeStage.Arrived

export const isNoticeDelivery = (event: EventDraft): boolean =>
  noticeOf(event)?.stage === ENoticeStage.Delivered

export const reachesModel = (event: EventDraft): boolean =>
  !isNoticeArrival(event) && !isBookkeepingEnding(event)

export const recordsLifecycle = (event: EventDraft): boolean => !isNoticeDelivery(event)

export const noticeIdOf = (event: EventDraft): string | undefined => noticeOf(event)?.id

export function owedNotices(events: readonly Event[]): readonly Event[] {
  const delivered = new Set<string>()
  for (const event of events) {
    const notice = noticeOf(event)
    if (notice?.stage === ENoticeStage.Delivered) delivered.add(notice.id)
  }

  return events.filter((event) => {
    const notice = noticeOf(event)
    return (
      notice?.stage === ENoticeStage.Arrived &&
      !isBookkeepingEnding(event) &&
      !delivered.has(notice.id)
    )
  })
}

export function deliveredDraftOf(event: Event): EventDraft | undefined {
  const notice = noticeOf(event)
  if (notice?.stage !== ENoticeStage.Arrived) return undefined

  const { id, seq, threadId, runId, parentRunId, depth, at, ...draft } = event
  return withNotice({ draft, notice: { id: notice.id, stage: ENoticeStage.Delivered } })
}

export const arrivedDraft = ({ draft, id }: { draft: EventDraft; id: string }): EventDraft =>
  withNotice({ draft, notice: { id, stage: ENoticeStage.Arrived } })

export const deliveredDraft = ({ draft, id }: { draft: EventDraft; id: string }): EventDraft =>
  withNotice({ draft, notice: { id, stage: ENoticeStage.Delivered } })
