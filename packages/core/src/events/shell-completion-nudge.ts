import type { EventOfType } from './envelope'
import { awaitsReply } from './projections'
import type { Event } from './envelope'

export function shellCompletionNudge(args: {
  events: readonly Event[]
  seenThrough: number | undefined
}): Pick<EventOfType<'nudge'>, 'type' | 'text' | 'lifetimeSteps'> | undefined {
  if (args.seenThrough === undefined || awaitsReply(args.events)) return undefined
  const seenThrough = args.seenThrough
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
