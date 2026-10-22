import { ETldrStatus, latestTldrPerAnchor, tldrAnchor, type Event } from '@dltech/atlas-core'

export enum ETitleState {
  Idle = 'idle',
  Working = 'working',
  NeedsOperator = 'needs-operator',
}

export function titleStateOf(args: {
  working: boolean
  asking: boolean
  endedOnQuestion: boolean
  backgroundBusy: boolean
}): ETitleState {
  if (args.asking) return ETitleState.NeedsOperator
  if (args.working) return ETitleState.Working
  if (args.endedOnQuestion) return ETitleState.NeedsOperator
  return args.backgroundBusy ? ETitleState.Working : ETitleState.Idle
}

export function endedOnQuestion(events: readonly Event[]): boolean {
  const anchorSeq = tldrAnchor(events)
  if (anchorSeq === undefined) return false

  const footer = latestTldrPerAnchor(events).find((written) => written.anchorSeq === anchorSeq)
  return footer?.status === ETldrStatus.NeedsOperator
}
