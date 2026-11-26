import type { EAgentStatus, EResumeOutcome } from '@dltech/atlas-core'

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
    group?: string | undefined
    worktree?: WorktreeEntryInfo | undefined
  }): Promise<SubagentSnapshot>
  say(args: {
    agentId: string
    text: string
    clientId?: string | undefined
  }): Promise<SubagentSaid | undefined>
  stop(args: { agentId: string }): Promise<SubagentSnapshot>
  resume(args: { agentId: string }): Promise<EResumeOutcome>
  list(): readonly SubagentSnapshot[]
  report(args: { text: string; clientId?: string | undefined }): Promise<SubagentSnapshot>
}
