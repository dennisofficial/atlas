import { EKilledBy, EServiceStatus, type V2Event } from '@dltech/atlas-core'
import { EServiceRunStatus, type ServiceInfo } from '@dltech/atlas-protocol'

export type ServiceOutcome = {
  status: EServiceStatus
  killedBy?: EKilledBy | undefined
  exitCode?: number | undefined
}

export const outcomeOf = (args: { info: ServiceInfo; stoppedByModel: boolean }): ServiceOutcome => {
  const { info } = args
  const exitCode = info.exitCode === null ? undefined : info.exitCode
  if (info.status === EServiceRunStatus.Starting || info.status === EServiceRunStatus.Ready) {
    return { status: EServiceStatus.Running }
  }
  if (info.status === EServiceRunStatus.Stopped) {
    return {
      status: EServiceStatus.Killed,
      killedBy: args.stoppedByModel ? EKilledBy.Model : EKilledBy.Unrecorded,
      exitCode,
    }
  }
  return { status: EServiceStatus.Exited, exitCode }
}

export type StartedService = {
  description?: string | undefined
  command: string
}

export const startedOf = (args: {
  events: readonly V2Event[]
  serviceId: string
}): StartedService | undefined => {
  for (const event of args.events) {
    if (event.type === 'service-started' && event.serviceId === args.serviceId) {
      return { command: event.command, description: event.description }
    }
  }
  return undefined
}

const hasEvent = (args: {
  events: readonly V2Event[]
  serviceId: string
  type: 'service-ready' | 'service-ended'
}): boolean =>
  args.events.some((event) => event.type === args.type && event.serviceId === args.serviceId)

export const hasEnded = (args: { events: readonly V2Event[]; serviceId: string }): boolean =>
  hasEvent({ ...args, type: 'service-ended' })

export const hasReady = (args: { events: readonly V2Event[]; serviceId: string }): boolean =>
  hasEvent({ ...args, type: 'service-ready' })
