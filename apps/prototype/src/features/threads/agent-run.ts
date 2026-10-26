import { runningAgentCount, type AgentsPanelAgent } from '@dltech/atlas-ui/ai/agents-panel'
import { EToolKind, EToolState, toolTitle, type ToolProps } from '@dltech/atlas-ui/ai/tool'

export interface AgentRun extends Omit<AgentsPanelAgent, 'report' | 'latestCall'> {
  report?: string
}

export function isLiveAgent(run: AgentRun): boolean {
  return runningAgentCount([run]) > 0
}

export function latestCallLine(calls: ToolProps[]): string {
  const call = calls.at(-1)
  if (!call) return 'Starting'
  return toolTitle({
    kind: call.kind ?? EToolKind.Shell,
    state: EToolState.Running,
    label: call.label,
  })
}
