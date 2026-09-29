import {
  EKilledBy,
  EServiceStatus,
  lostServicesOf,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

export type LostService = {
  serviceId: string
  command: string
  description?: string | undefined
}

/**
 * A service outlives the process that ran it only in the record: the spawned child dies with the
 * harness, so a start with no end behind it means the harness died while the service was running —
 * a clean close records an end for every live service, and the absence of one is a crash or a
 * kill. The pairing that decides "no end behind it" lives in core (`lostServicesOf`), shared with
 * teardown and the transcript so the three never disagree; this class owns only the I/O of reading
 * the log and appending the synthetic end, and the once-per-thread guard that keeps a revisit free.
 */
export class ServiceRecovery {
  private readonly log: EventLogPort
  private readonly ids: IdPort
  private readonly reconciled = new Set<ThreadId>()

  constructor(args: { log: EventLogPort; ids: IdPort }) {
    this.log = args.log
    this.ids = args.ids
  }

  async recordLost(args: { threadId: ThreadId }): Promise<readonly LostService[]> {
    const { threadId } = args
    if (this.reconciled.has(threadId)) return []
    this.reconciled.add(threadId)

    const events = await this.log.readOwn({ threadId })
    const lost = lostServicesOf(events)
    if (lost.length === 0) return []

    await this.log.append({
      threadId,
      runId: this.ids.nextRunId(),
      drafts: lost.map((service) =>
        lostServiceEnding({
          serviceId: service.key,
          command: service.started.command,
          description: service.started.description,
          bootId: service.started.bootId,
        }),
      ),
    })

    return lost.map((service) => ({
      serviceId: service.key,
      command: service.started.command,
      description: service.started.description,
    }))
  }
}

export function lostServiceEnding(service: {
  serviceId: string
  command: string
  description?: string | undefined
  bootId?: string | undefined
}): {
  type: 'service-ended'
  serviceId: string
  command: string
  description?: string | undefined
  bootId?: string | undefined
  status: EServiceStatus
  killedBy: EKilledBy
  logPath?: string | undefined
  tail: string
} {
  return {
    type: 'service-ended',
    serviceId: service.serviceId,
    command: service.command,
    description: service.description,
    bootId: service.bootId,
    status: EServiceStatus.Killed,
    killedBy: EKilledBy.Unrecorded,
    tail: '',
  }
}
