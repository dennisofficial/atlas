import type { PresenceState } from '@dltech/atlas-notifications/client'

const SESSION_PATH = /\/sessions\/([^/]+)\/?$/

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export const sessionIdOfPathname = (pathname: string): string | null => {
  const segment = SESSION_PATH.exec(pathname)?.[1]
  return segment === undefined ? null : decodeSegment(segment)
}

export const presenceStateOf = (args: {
  sessionId: string | null
  appState: string | null | undefined
}): PresenceState => ({
  sessionId: args.sessionId,
  foreground: args.appState === 'active',
})
