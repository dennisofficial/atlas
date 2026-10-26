import { EAgentDisplay } from './agent-status'
import type { AgentsPanelAgent } from './agents-panel-types'
import type { ToolProps } from './tool'

export enum EDetailRow {
  Brief = 'brief',
  CallsLabel = 'calls-label',
  Call = 'call',
  Outcome = 'outcome',
}

export type DetailRow =
  | { key: string; kind: EDetailRow.Brief }
  | { key: string; kind: EDetailRow.CallsLabel; count: number }
  | { key: string; kind: EDetailRow.Call; call: ToolProps }
  | { key: string; kind: EDetailRow.Outcome }

export function toolCallsLabel(count: number): string {
  return `Tool calls · ${count}`
}

export function hasOutcome(agent: AgentsPanelAgent): boolean {
  if (agent.display === EAgentDisplay.Failed) return Boolean(agent.errorText)
  return agent.display === EAgentDisplay.Done && Boolean(agent.report)
}

interface DetailRowsInput {
  agent: AgentsPanelAgent
}

export function detailRows({ agent }: DetailRowsInput): DetailRow[] {
  const rows: DetailRow[] = [{ key: 'brief', kind: EDetailRow.Brief }]
  if (agent.calls.length > 0) {
    rows.push({ key: 'calls-label', kind: EDetailRow.CallsLabel, count: agent.calls.length })
    agent.calls.forEach((call, index) => {
      rows.push({ key: `call-${index}`, kind: EDetailRow.Call, call })
    })
  }
  if (hasOutcome(agent)) rows.push({ key: 'outcome', kind: EDetailRow.Outcome })
  return rows
}
