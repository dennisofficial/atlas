import { systemNotice } from '../../context/envelope'
import type { EventOfType } from '../../events/envelope'
import { serviceEnding } from '../../services/status'
import { shellLabel } from '../../shells/label'
import { EKilledBy } from '../../shells/status'

const PRINTED_NOTHING = 'Its log is empty.'

const USER_KILLED =
  'The operator stopped this service deliberately. Nothing is wrong. Do not restart it or work around it unless the operator asks.'

const SLEPT_THROUGH: ReadonlySet<EKilledBy | undefined> = new Set([
  EKilledBy.SessionEnd,
  EKilledBy.IdlePark,
])

const WOKE_UP = 'Start it again if you still need it.'

const NOT_WORK =
  'This was infrastructure you work against, not work you were waiting on. Its full log is at the path above. Read it with the read tool if you need more than the tail.'

const NO_LOG = 'Its log is gone with the process that ran it.'

export function serviceEndedBlock(event: EventOfType<'service-ended'>): string {
  const where = event.logPath === undefined ? NO_LOG : `Its log is at ${event.logPath}.`
  const headline = `Service ${event.serviceId} ${shellLabel(event)} ${serviceEnding(event)}. ${where}`

  const sections = [headline]

  if (event.killedBy === EKilledBy.User) sections.push(USER_KILLED)
  if (SLEPT_THROUGH.has(event.killedBy)) sections.push(WOKE_UP)

  sections.push(event.tail.trimEnd() === '' ? PRINTED_NOTHING : event.tail.trimEnd())

  if (event.logPath !== undefined) sections.push(NOT_WORK)

  return systemNotice({ kind: 'service-ended', content: sections.join('\n\n') })
}
