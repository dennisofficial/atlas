import type { ControlSessionRow } from '@dltech/atlas-control'
import { SessionArchivedError } from './session-archived.error'

const ARCHIVED_ALLOWED_COMMANDS = new Set(['rename'])

const refuseArchivedSession = (session: ControlSessionRow): void => {
  if (session.archivedAt !== null) throw new SessionArchivedError()
}

export const requireLiveSession = (session: ControlSessionRow): ControlSessionRow => {
  refuseArchivedSession(session)
  return session
}

export const refuseArchivedCommand = (args: { session: ControlSessionRow; name: string }): void => {
  if (ARCHIVED_ALLOWED_COMMANDS.has(args.name)) return
  refuseArchivedSession(args.session)
}
