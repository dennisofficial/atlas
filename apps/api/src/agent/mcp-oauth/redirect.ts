import type { McpReturnScreen, McpReturnSurface } from './types'

export const DEFAULT_RETURN_TO = '/settings/integrations'

const USER_SETTINGS_PATH = DEFAULT_RETURN_TO

const segment = (value: string): string => encodeURIComponent(value)

export const returnPathOf = (screen: McpReturnScreen): string => {
  if (screen.kind === 'session') return `/sessions/${segment(screen.id)}`
  if (screen.scope === 'project') return `/projects/${segment(screen.id)}/settings/mcp`
  if (screen.scope === 'group') return `/groups/${segment(screen.id)}/settings/mcp`
  return USER_SETTINGS_PATH
}

export const surfaceOf = (value: string | null | undefined): McpReturnSurface =>
  value === 'desktop' || value === 'ios' ? value : 'web'
