import type { EventOfType } from './envelope'
import { awaitsReply } from './projections'
import type { Event } from './envelope'

export function shellCompletionNudge(args: {
  events: readonly Event[]
  seenThrough: number | undefined
}): Pick<EventOfType<'nudge'>, 'type' | 'text' | 'lifetimeSteps'> | undefined {
  if (args.seenThrough === undefined || awaitsReply(args.events)) return undefined
  const seenThrough = args.seenThrough

  const lastAssistantIndex = args.events.findLastIndex((event) => event.type === 'assistant-said')
  const toldSince = args.events.some(
    (event, index) =>
      index > lastAssistantIndex && (event.type === 'nudge' || event.type === 'user-said'),
  )
  if (toldSince) return undefined

  const unseenEnding = args.events.some(
    (event) => event.type === 'background-shell-ended' && event.seq > seenThrough,
  )
  if (!unseenEnding) return undefined

  return {
    type: 'nudge',
    text: 'A background shell finished while you were responding. Its ending is already recorded above; address that result before ending this turn.',
    lifetimeSteps: 1,
  }
}
