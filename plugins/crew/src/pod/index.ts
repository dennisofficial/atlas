import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { EnterWorktreeTool } from './enter-worktree'
import { ExitWorktreeTool } from './exit-worktree'
import { CrewFragment } from './fragment'
import { AgentListTool } from './list-tool'
import { ReportToMainTool } from './report-tool'
import { AgentSayTool } from './say-tool'
import { AgentSpawnTool } from './spawn-tool'
import { AgentStopTool } from './stop-tool'
import { WorktreeListTool } from './worktree-list'
import { worktreeTrackHook } from './worktree-hook'

export { EnterWorktreeTool } from './enter-worktree'
export { ExitWorktreeTool } from './exit-worktree'
export { CrewFragment } from './fragment'
export { AgentListTool } from './list-tool'
export { crewRefusal } from './outcome'
export { ReportToMainTool } from './report-tool'
export { AgentSayTool } from './say-tool'
export { AgentSpawnTool } from './spawn-tool'
export { AgentStopTool } from './stop-tool'
export { WorktreeListTool } from './worktree-list'
export { worktreeTrackHook } from './worktree-hook'

export const CREW_TOOLS = [
  'agent_spawn',
  'agent_say',
  'agent_stop',
  'agent_list',
  'report_to_main',
] as const

export const WORKTREE_TOOLS = ['enter_worktree', 'exit_worktree', 'worktree_list'] as const

export const CREW_CHILD_DENIED = ['agent_spawn', 'agent_say', 'agent_stop', 'agent_list'] as const

export const crewPod: PodSlot = {
  ...EMPTY_POD,
  childDeny: CREW_CHILD_DENIED,
  tools: (ctx) => [
    new AgentSpawnTool(ctx),
    new AgentSayTool(ctx),
    new AgentStopTool(ctx),
    new AgentListTool(ctx),
    new ReportToMainTool(ctx),
    new EnterWorktreeTool(ctx),
    new ExitWorktreeTool(ctx),
    new WorktreeListTool(ctx),
  ],
  hooks: () => ({ afterTool: [worktreeTrackHook] }),
  prompts: [new CrewFragment()],
}
