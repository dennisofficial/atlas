import { threadHandle, type ActiveConversation } from '@dltech/atlas-harness'

import { collapseHome } from '../ui/paths'
import { EOpenMode, type OpenRequest } from './config'

const SEPARATOR = ' · '

const PREFIX = 'atlas'

const timeOf = (at: Date): string =>
  [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')

const openLabel = (open: OpenRequest): string | null => {
  if (open.mode === EOpenMode.Resume) return `resume "${open.threadId}"`
  if (open.mode === EOpenMode.Continue) return 'continue'
  return null
}

/**
 * The renderer takes the alternate screen the moment it comes up and gives it back on exit, so this
 * is the one moment a launch can leave a line in the scrollback the operator keeps. A crash, a kill
 * or an auto-restart all land after it, and none of them can erase it.
 */
export function launchLine(args: {
  open: OpenRequest
  directory: string
  home: string | undefined
  pid: number
  at: Date
}): string {
  const parts = [
    PREFIX,
    timeOf(args.at),
    `pid ${args.pid}`,
    collapseHome({ cwd: args.directory, home: args.home ?? '' }),
  ]

  const opened = openLabel(args.open)
  if (opened !== null) parts.push(opened)

  return `${parts.join(SEPARATOR)}\n`
}

/**
 * A restart repaints the tab before the harness knows the conversation's name, so a launch that was
 * handed one keeps it rather than falling back to the directory and erasing which tile is which.
 */
export function launchTitle(open: OpenRequest): string | null {
  return open.mode === EOpenMode.Resume ? open.threadId : null
}

export function sessionIdentityLine(args: {
  active: ActiveConversation | null
  directory: string
  home: string | undefined
  pid: number
}): string {
  const parts = [
    args.active === null ? 'no conversation yet' : threadHandle(args.active),
    collapseHome({ cwd: args.directory, home: args.home ?? '' }),
    `pid ${args.pid}`,
  ]

  return parts.join(SEPARATOR)
}
