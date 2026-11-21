import type { V2Event } from './event'

export const attemptTagOf = (event: V2Event): number | undefined =>
  event.type === 'workspace-step' || event.type === 'workspace-prepare-failed'
    ? event.attempt
    : undefined

export const latestAttemptOf = (events: readonly V2Event[]): number => {
  let latest = 0
  for (const event of events) {
    if (event.type === 'workspace-attempt-started') latest = Math.max(latest, event.attempt)
  }
  return latest
}

export const nextAttemptOf = (events: readonly V2Event[]): number => latestAttemptOf(events) + 1

export const attemptIsCurrent = (args: {
  attempt: number | undefined
  latest: number
  position: number
}): boolean => {
  if (args.latest === 0) return true
  return (args.attempt ?? args.position) === args.latest
}

export const withinLatestAttempt = <TEvent extends V2Event>(args: {
  events: readonly V2Event[]
  keep: (event: V2Event) => event is TEvent
}): TEvent[] => {
  const latest = latestAttemptOf(args.events)
  let position = 0
  const kept: TEvent[] = []
  for (const event of args.events) {
    if (event.type === 'workspace-attempt-started') {
      position = event.attempt
      continue
    }
    if (!attemptIsCurrent({ attempt: attemptTagOf(event), latest, position })) continue
    if (args.keep(event)) kept.push(event)
  }
  return kept
}
