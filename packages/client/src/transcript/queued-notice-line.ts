import { serviceFailed, type EventBody } from '@dltech/atlas-core'

import { agentEndedLine, agentEndingFailed, agentReportedLine } from './agent-ended-line'
import { prEventFailed, prEventLine } from './pr-event-line'
import { serviceEndedLine } from './service-ended-line'
import { shellEndedLine, shellEndingFailed } from './shell-ended-line'

export type QueuedNoticeLine = { text: string; failed: boolean }

export function queuedNoticeLineOf(event: EventBody): QueuedNoticeLine | undefined {
  if (event.type === 'agent-reported') {
    return { text: agentReportedLine(event), failed: false }
  }

  if (event.type === 'agent-ended') {
    if (event.relayed === false) return undefined
    return { text: agentEndedLine(event), failed: agentEndingFailed(event) }
  }

  if (event.type === 'background-shell-ended') {
    return { text: shellEndedLine(event), failed: shellEndingFailed(event) }
  }

  if (event.type === 'service-ended') {
    if (event.restarting === true || event.agentId !== undefined) return undefined
    return { text: serviceEndedLine(event), failed: serviceFailed(event) }
  }

  if (event.type === 'pr-event') {
    return { text: prEventLine(event), failed: prEventFailed(event) }
  }

  if (event.type === 'run-event') {
    return { text: `${event.workflow} #${event.workflowRunId} ${event.conclusion}`, failed: false }
  }

  if (event.type === 'sandbox-setup-reported') {
    return { text: event.text, failed: event.failed }
  }

  return undefined
}
