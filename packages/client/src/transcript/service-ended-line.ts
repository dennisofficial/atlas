import {
  EKilledBy,
  EServiceStatus,
  quotedShellCommand,
  serviceEnding,
  serviceFailed,
  type ServiceEnding,
} from '@dltech/atlas-core'

export type ServiceEndedNotice = ServiceEnding & {
  serviceId: string
  command: string
  description?: string | undefined
}

type NamedService = { command: string; description?: string | undefined }

const named = (service: NamedService): string => {
  const description = service.description?.trim() ?? ''
  return description === '' ? quotedShellCommand(service.command) : `"${description}"`
}

const outcomeOf = (ending: ServiceEnding): string => {
  if (ending.status !== EServiceStatus.Killed) return serviceEnding(ending)
  if (ending.killedBy === EKilledBy.User) return 'was stopped by you'
  if (ending.killedBy === EKilledBy.Model) return 'was stopped by atlas'
  return serviceEnding(ending)
}

export const serviceEndedLine = (ended: ServiceEndedNotice): string =>
  `Service ${ended.serviceId} ${named(ended)} ${outcomeOf(ended)}`

export const serviceEndingFailed = (ending: ServiceEnding): boolean => serviceFailed(ending)
