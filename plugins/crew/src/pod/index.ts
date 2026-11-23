import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { EnterWorktreeTool } from './enter-worktree'
import { ExitWorktreeTool } from './exit-worktree'
import { CrewFragment } from './fragment'
import { repoAgentListingHook } from './hooks'
import { AgentListTool } from './list-tool'
import { repoAgentTypesResource } from './resource'
import { AgentSpawnTool } from './spawn-tool'
import { AgentStopTool } from './stop-tool'
import { WorktreeListTool } from './worktree-list'
import { worktreeTrackHook } from './worktree-hook'

export { EnterWorktreeTool } from './enter-worktree'
export { ExitWorktreeTool } from './exit-worktree'
export { CrewFragment } from './fragment'
export { repoAgentListingHook } from './hooks'
export { REPO_AGENT_HEADING, repoAgentListingOf } from './listing'
export { AgentListTool } from './list-tool'
export { crewRefusal } from './outcome'
export { discoverRepoAgentTypes, REPO_AGENT_ROOTS } from './repo-agent-types'
export { CREW_AGENT_TYPES_RESOURCE, repoAgentTypesResource } from './resource'
export { AgentSpawnTool } from './spawn-tool'
export { AgentStopTool } from './stop-tool'
export { WorktreeListTool } from './worktree-list'
export { worktreeTrackHook } from './worktree-hook'

export const CREW_TOOLS = ['agent_spawn', 'agent_stop', 'agent_list'] as const

export const WORKTREE_TOOLS = ['enter_worktree', 'exit_worktree', 'worktree_list'] as const

export const CREW_CHILD_DENIED = ['agent_spawn', 'agent_stop', 'agent_list'] as const

export const crewPod: PodSlot = {
  ...EMPTY_POD,
  childDeny: CREW_CHILD_DENIED,
  tools: (ctx) => [
    new AgentSpawnTool(ctx),
    new AgentStopTool(ctx),
    new AgentListTool(ctx),
    new EnterWorktreeTool(ctx),
    new ExitWorktreeTool(ctx),
    new WorktreeListTool(ctx),
  ],
  resources: [repoAgentTypesResource],
  hooks: (ctx) => ({
    beforeStep: [repoAgentListingHook({ ctx })],
    afterTool: [worktreeTrackHook],
  }),
  prompts: [new CrewFragment()],
}
