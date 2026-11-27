import { mcpServerLabelOf } from '@dltech/atlas-client/settings'
import type { McpOauthServer } from '@dltech/atlas-wire/web'

export type McpSignInTarget = { serverId: string; label: string }

export const signInTargetOf = (server: McpOauthServer | undefined): McpSignInTarget | undefined =>
  server === undefined ? undefined : { serverId: server.id, label: mcpServerLabelOf(server.url) }
