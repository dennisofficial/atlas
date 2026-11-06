import type { Event, EventOfType } from './envelope'
import { reachesModel } from './notice-stage'
import { awaitsReply } from './projections'

type ShellCompletionNudge = Pick<EventOfType<'nudge'>, 'type' | 'text' | 'lifetimeSteps'>

export function shellCompletionNudgeFrom({
  awaitingReply,
  lastAssistantSeq,
  tail,
  seenThrough,
}: {
  awaitingReply: boolean
  lastAssistantSeq: number | undefined
  tail: readonly Event[]
  seenThrough: number | undefined
}): ShellCompletionNudge | undefined {
  if (seenThrough === undefined || awaitingReply) return undefined

  const toldSince = tail.some(
    (event) =>
      (event.type === 'nudge' || event.type === 'user-said') && event.seq > (lastAssistantSeq ?? 0),
  )
  if (toldSince) return undefined

  const unseenEnding = tail.some(
    (event) =>
      event.type === 'background-shell-ended' && reachesModel(event) && event.seq > seenThrough,
  )
  if (!unseenEnding) return undefined

  return {
    type: 'nudge',
    text: 'A background shell finished while you were responding. Its ending is already recorded above; address that result before ending this turn.',
    lifetimeSteps: 1,
  }
}

export function shellCompletionNudge(args: {
  events: readonly Event[]
  seenThrough: number | undefined
}): ShellCompletionNudge | undefined {
  return shellCompletionNudgeFrom({
    awaitingReply: awaitsReply(args.events),
    lastAssistantSeq: args.events.findLast((event) => event.type === 'assistant-said')?.seq,
    tail: args.events,
    seenThrough: args.seenThrough,
  })
}
