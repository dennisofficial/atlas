import { TEAMMATE_AGENT_TYPE } from '../../agents/kind'
import { agentLabel } from '../../agents/label'
import { wrapInSystemReminder } from '../../context/render'
import type { ThreadId } from '../../events/ids'
import { defineRule, type Rule } from '../rule'
import { appendedAtTail } from './tail-block'

export type RunningAgent = {
  agentId: string
  agentType: string
  intent: string
}

export type RunningAgentsSource = (args: { threadId: ThreadId }) => readonly RunningAgent[]

const SUB_AGENT_LINE =
  'Each sub-agent’s final answer arrives on its own, even after this turn ends, and a sub-agent that finishes while nothing else is running opens a turn to deliver it.'
const TEAMMATE_LINE =
  'A teammate reports only when it sends an explicit report, and is silent between reports.'
const WAITING_LINE =
  'Work that does not depend on them can continue meanwhile; if you are only waiting, say what for and end your turn. agent_say({ agentId, text }) steers one and agent_stop({ agentId }) ends one early.'

const guidanceFor = (agents: readonly RunningAgent[]): string =>
  [
    SUB_AGENT_LINE,
    ...(agents.some((agent) => agent.agentType === TEAMMATE_AGENT_TYPE) ? [TEAMMATE_LINE] : []),
    WAITING_LINE,
  ].join(' ')

const lineFor = (agent: RunningAgent): string => `${agent.agentId}  ${agentLabel(agent)}`

export function runningAgentsReminder(agents: readonly RunningAgent[]): string {
  return wrapInSystemReminder(
    [
      'These sub-agents you spawned are still running:',
      agents.map(lineFor).join('\n'),
      guidanceFor(agents),
    ].join('\n\n'),
  )
}

export function runningAgentsBlock({
  runningAgents,
}: {
  runningAgents: RunningAgentsSource
}): Rule {
  return defineRule({
    name: 'runningAgentsBlock',
    apply: (input, ctx) => {
      const agents = runningAgents({ threadId: ctx.threadId })
      if (agents.length === 0) return input

      return appendedAtTail({ input, ctx, text: runningAgentsReminder(agents) })
    },
  })
}
