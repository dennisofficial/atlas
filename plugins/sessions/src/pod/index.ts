import { type PodSlot } from '@dltech/atlas-plugin-sdk'

import { ArchiveSessionTool } from './archive-tool'
import { PeerSessionsFragment } from './fragment'
import { ListSessionsTool } from './list-tool'
import { ListTeammatesTool } from './list-teammates'
import { SendMessageTool } from './send-message'
import { SpawnSessionTool } from './spawn-tool'
import { SpawnTeammateTool } from './spawn-teammate'

export { ArchiveSessionTool } from './archive-tool'
export { PeerSessionsFragment } from './fragment'
export { ListSessionsTool } from './list-tool'
export { ListTeammatesTool } from './list-teammates'
export { SendMessageTool } from './send-message'
export { sessionsRefusal } from './outcome'
export { SpawnSessionTool } from './spawn-tool'
export { SpawnTeammateTool } from './spawn-teammate'

export const SESSION_TOOLS = [
  'send_message',
  'archive_session',
  'spawn_session',
  'spawn_teammate',
  'list_sessions',
  'list_teammates',
] as const

export const sessionsPod: PodSlot = {
  tools: (ctx) => [
    new SendMessageTool(ctx),
    new ArchiveSessionTool(ctx),
    new SpawnSessionTool(ctx),
    new SpawnTeammateTool(ctx),
    new ListSessionsTool(ctx),
    new ListTeammatesTool(ctx),
  ],
  prompts: [new PeerSessionsFragment()],
  commands: new Map(),
}
