import { EAgentStatus } from '../../agents/status'
import { EServiceStatus } from '../../services/status'
import { EShellStatus } from '../../shells/status'
import type { EventDraft } from '../body'
import { toThreadId } from '../ids'
import { arrivedDraft, deliveredDraft } from '../notice-stage'

export const CHILD = toThreadId('thread-child-1')

export const agentEnded = (
  over: Partial<Extract<EventDraft, { type: 'agent-ended' }>> = {},
): EventDraft => ({
  type: 'agent-ended',
  agentId: CHILD,
  agentType: 'explore',
  intent: 'audit the registry',
  status: EAgentStatus.Finished,
  prose: 'found two unread settings',
  turns: 2,
  toolCalls: 5,
  ...over,
})

export const agentReported: EventDraft = {
  type: 'agent-reported',
  agentId: CHILD,
  agentType: 'teammate',
  intent: 'build the app',
  prose: 'halfway there',
}

export const shellEnded: EventDraft = {
  type: 'background-shell-ended',
  shellId: 'bash_1',
  command: 'npm test',
  status: EShellStatus.Exited,
  exitCode: 0,
  output: 'all green',
  droppedCharacters: 0,
  remainingCharacters: 0,
}

export const serviceEnded: EventDraft = {
  type: 'service-ended',
  serviceId: 'svc_1',
  command: 'npm run dev',
  status: EServiceStatus.Exited,
  tail: 'bye',
}

export const arrived = (draft: EventDraft, id = 'notice-1'): EventDraft =>
  arrivedDraft({ draft, id })
export const delivered = (draft: EventDraft, id = 'notice-1'): EventDraft =>
  deliveredDraft({ draft, id })
