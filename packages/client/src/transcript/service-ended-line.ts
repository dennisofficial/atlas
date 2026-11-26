import {
  EKilledBy,
  EServiceStatus,
  quotedShellName,
  serviceEnding,
  type ServiceEnding,
} from '@dltech/atlas-core'

export type ServiceEndedNotice = ServiceEnding & {
  serviceId: string
  command: string
  description?: string | undefined
}

const outcomeOf = (ending: ServiceEnding): string => {
  if (ending.status !== EServiceStatus.Killed) return serviceEnding(ending)
  if (ending.killedBy === EKilledBy.User) return 'was stopped by you'
  if (ending.killedBy === EKilledBy.Model) return 'was stopped by atlas'
  return serviceEnding(ending)
}

export const serviceEndedLine = (ended: ServiceEndedNotice): string =>
  `Service ${ended.serviceId} ${quotedShellName(ended)} ${outcomeOf(ended)}`
