import { EAgentRestart, type Event, type EventOfType } from '@dltech/atlas-core'

export const deliberateAgentRestart = (event: EventOfType<'agent-restarted'>): boolean =>
  event.via !== EAgentRestart.Wake

const breaksEveryRun = (event: Event): boolean =>
  event.type === 'user-said' ||
  event.type === 'nudge' ||
  event.type === 'background-shell-ended' ||
  event.type === 'background-shell-awaiting-input' ||
  event.type === 'background-shell-matched' ||
  event.type === 'background-shell-still-running' ||
  event.type === 'service-ended' ||
  event.type === 'agent-ended' ||
  event.type === 'agent-reported' ||
  event.type === 'pr-event' ||
  event.type === 'location-changed' ||
  event.type === 'parked' ||
  event.type === 'history-compacted'

export const transcriptNotice = (event: Event): boolean =>
  breaksEveryRun(event) ||
  (event.type === 'agent-restarted' && deliberateAgentRestart(event))
