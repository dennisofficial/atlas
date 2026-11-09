import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { CrewFragment } from './fragment'
import { AgentListTool } from './list-tool'
import { ReportToMainTool } from './report-tool'
import { AgentSayTool } from './say-tool'
import { AgentSpawnTool } from './spawn-tool'
import { AgentStopTool } from './stop-tool'

export { CrewFragment } from './fragment'
export { AgentListTool } from './list-tool'
export { crewRefusal } from './outcome'
export { ReportToMainTool } from './report-tool'
export { AgentSayTool } from './say-tool'
export { AgentSpawnTool } from './spawn-tool'
export { AgentStopTool } from './stop-tool'

export const CREW_TOOLS = [
  'agent_spawn',
  'agent_say',
  'agent_stop',
  'agent_list',
  'report_to_main',
] as const

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
  ],
  prompts: [new CrewFragment()],
}
