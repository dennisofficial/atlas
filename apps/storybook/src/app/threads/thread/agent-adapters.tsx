import type { AgentsPanelAgent } from '@dltech/atlas-ui/ai/agents-panel'
import { MessageResponse } from '@dltech/atlas-ui/ai/message-response'
import type { SubagentReportEntry } from '@dltech/atlas-ui/ai/subagent-report'

import { type AgentRun, isLiveAgent, latestCallLine } from './agent-run'

export function toPanelAgent(run: AgentRun): AgentsPanelAgent {
  return {
    ...run,
    report: run.report === undefined ? undefined : <MessageResponse>{run.report}</MessageResponse>,
    latestCall: isLiveAgent(run) ? latestCallLine(run.calls) : undefined,
  }
}

export function toReportEntry(run: AgentRun): SubagentReportEntry {
  return {
    id: run.id,
    agentType: run.agentType,
    intent: run.intent,
    display: run.display,
    elapsed: run.elapsed,
    report: run.report,
    errorText: run.errorText,
  }
}
