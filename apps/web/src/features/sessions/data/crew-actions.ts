import { EAgentStatus } from '@dltech/atlas-core'
import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'

export const AGENT_COMMAND = 'agent'

export type AgentActionApi = {
  command(input: SessionCommandInput): Promise<SessionCommandOutput>
}

const ENDED: ReadonlySet<EAgentStatus> = new Set([
  EAgentStatus.Finished,
  EAgentStatus.Failed,
  EAgentStatus.Stopped,
])

export const agentAlive = (status: EAgentStatus): boolean => !ENDED.has(status)

export const stopAgent = async (args: {
  api: AgentActionApi
  sessionId: string
  agentId: string
}): Promise<void> => {
  await args.api.command({
    sessionId: args.sessionId,
    name: AGENT_COMMAND,
    args: { action: 'stop', agentId: args.agentId },
  })
}

export const sayToAgent = async (args: {
  api: AgentActionApi
  sessionId: string
  agentId: string
  text: string
}): Promise<void> => {
  const text = args.text.trim()
  if (text === '') return
  await args.api.command({
    sessionId: args.sessionId,
    name: AGENT_COMMAND,
    args: { action: 'say', agentId: args.agentId, text },
  })
}
