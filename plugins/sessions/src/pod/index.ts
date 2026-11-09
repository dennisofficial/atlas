import { type PodSlot } from '@dltech/atlas-plugin-sdk'

import { PeerSessionsFragment } from './fragment'
import { ListSessionsTool } from './list-tool'
import { MessageSessionTool } from './message-tool'
import { SpawnSessionTool } from './spawn-tool'

export { PeerSessionsFragment } from './fragment'
export { ListSessionsTool } from './list-tool'
export { MessageSessionTool } from './message-tool'
export { sessionsRefusal } from './outcome'
export { SpawnSessionTool } from './spawn-tool'

export const SESSION_TOOLS = ['spawn_session', 'message_session', 'list_sessions'] as const

export const sessionsPod: PodSlot = {
  tools: (ctx) => [
    new SpawnSessionTool(ctx),
    new MessageSessionTool(ctx),
    new ListSessionsTool(ctx),
  ],
  prompts: [new PeerSessionsFragment()],
  commands: new Map(),
}
