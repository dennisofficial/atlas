import { EMessageOrigin, saidBy } from '../../events/body'
import type { Event } from '../../events/envelope'
import { EGrantScope, type Grant } from './grant'
import { EClassifierMode } from './triage'

type Judged = Extract<Event, { type: 'classifier-judged' }>

const refusedTheAgent = (event: Event): event is Judged =>
  event.type === 'classifier-judged' &&
  event.mode === EClassifierMode.Nudge &&
  event.wouldAsk === true

const operatorSpoke = (event: Event): boolean =>
  event.type === 'user-said' && saidBy(event) === EMessageOrigin.Operator

export function grantsRepliedTo(events: readonly Event[]): readonly Grant[] {
  const reply = events.findLast(operatorSpoke)
  if (reply === undefined) return []

  const previousReply = events.findLast((event) => event.seq < reply.seq && operatorSpoke(event))
  const since = previousReply?.seq ?? 0

  return events
    .filter((event) => event.seq > since && event.seq < reply.seq)
    .filter(refusedTheAgent)
    .flatMap((refusal) =>
      (refusal.grantables ?? []).map((offer, index) => ({
        grantId: `reply:${refusal.callId}:${String(index)}`,
        dimensions: offer.dimensions,
        scope: EGrantScope.Thread,
        subject: offer.subject,
        reason: 'the operator answered the refusal in their own words',
        seq: reply.seq,
      })),
    )
}
