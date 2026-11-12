import { type PodSlot } from '@dltech/atlas-plugin-sdk'

import { PeerSessionsFragment } from './fragment'
import { ListSessionsTool } from './list-tool'
import { ListTeammatesTool } from './list-teammates'
import { MessageSessionTool } from './message-tool'
import { MessageTeammateTool } from './message-teammate'
import { ReportToSpawnerTool } from './report-tool'
import { SpawnSessionTool } from './spawn-tool'
import { SpawnTeammateTool } from './spawn-teammate'

export { PeerSessionsFragment } from './fragment'
export { ListSessionsTool } from './list-tool'
export { ListTeammatesTool } from './list-teammates'
export { MessageSessionTool } from './message-tool'
export { MessageTeammateTool } from './message-teammate'
export { sessionsRefusal } from './outcome'
export { ReportToSpawnerTool } from './report-tool'
export { SpawnSessionTool } from './spawn-tool'
export { SpawnTeammateTool } from './spawn-teammate'

export const SESSION_TOOLS = [
  'spawn_session',
  'spawn_teammate',
  'message_session',
  'message_teammate',
  'report_to_spawner',
  'list_sessions',
  'list_teammates',
] as const

export const sessionsPod: PodSlot = {
  tools: (ctx) => [
    new SpawnSessionTool(ctx),
    new SpawnTeammateTool(ctx),
    new MessageSessionTool(ctx),
    new MessageTeammateTool(ctx),
    new ReportToSpawnerTool(ctx),
    new ListSessionsTool(ctx),
    new ListTeammatesTool(ctx),
  ],
  prompts: [new PeerSessionsFragment()],
  commands: new Map(),
}
