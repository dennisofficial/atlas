import type { ReactNode } from 'react'

import type { EAgentDisplay } from './agent-status'
import type { ToolProps } from './tool'

export interface AgentContext {
  tokens: number
  window: number
}

export interface AgentsPanelAgent {
  id: string
  agentType: string
  intent: string
  display: EAgentDisplay
  elapsed: string
  model: string
  context?: AgentContext
  latestCall?: string
  endedAt?: number
  brief: string
  calls: ToolProps[]
  report?: ReactNode
  errorText?: string
}

export interface AgentsPanelTeammate {
  id: string
  title: string
  display: EAgentDisplay
}
