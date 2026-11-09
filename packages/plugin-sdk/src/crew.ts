import type { EAgentStatus, EReportKind } from '@dltech/atlas-core'

import type { WorktreeEntryInfo } from './worktrees'

export type SubagentWorktree = { path: string; branch: string }

export type SubagentSnapshot = {
  agentId: string
  agentType: string
  intent: string
  status: EAgentStatus
  turns: number
  toolCalls: number
  startedAt: string
  endedAt?: string | undefined
  prose?: string | undefined
  lastTool?: string | undefined
  worktree?: SubagentWorktree | undefined
}

export type SubagentSaid = { queued: boolean; snapshot: SubagentSnapshot }

export type PodCrew = {
  spawn(args: {
    agentType: string
    intent: string
    prompt: string
    worktree?: WorktreeEntryInfo | undefined
  }): Promise<SubagentSnapshot>
  say(args: { agentId: string; text: string }): Promise<SubagentSaid>
  stop(args: { agentId: string }): Promise<SubagentSnapshot>
  list(): readonly SubagentSnapshot[]
  report(args: { kind: EReportKind; text: string }): Promise<SubagentSnapshot>
}
