import type { Event } from '@dltech/atlas-core'

const breaksEveryRun = (event: Event): boolean =>
  event.type === 'user-said' ||
  event.type === 'nudge' ||
  event.type === 'sandbox-setup-reported' ||
  event.type === 'background-shell-ended' ||
  event.type === 'background-shell-awaiting-input' ||
  event.type === 'background-shell-matched' ||
  event.type === 'background-shell-still-running' ||
  (event.type === 'service-ended' && event.restarting !== true && event.agentId === undefined) ||
  (event.type === 'agent-ended' && event.relayed !== false) ||
  event.type === 'agent-reported' ||
  event.type === 'pr-event' ||
  event.type === 'location-changed' ||
  event.type === 'parked' ||
  event.type === 'history-compacted'

export const transcriptNotice = (event: Event): boolean => breaksEveryRun(event)
