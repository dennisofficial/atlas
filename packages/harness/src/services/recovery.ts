import {
  EKilledBy,
  EServiceStatus,
  lostServicesOf,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { bootId } from './boot'
import type { ServiceSnapshot } from './service-process'

export type LostService = {
  serviceId: string
  command: string
  description?: string | undefined
}

export type LiveService = {
  serviceId: string
}

/**
 * A service outlives the process that ran it only in the record: the spawned child dies with the
 * harness, so a start with no end behind it means the harness died while the service was running —
 * a clean close records an end for every live service, and the absence of one is a crash or a
 * kill. The pairing that decides "no end behind it" lives in core (`lostServicesOf`), shared with
 * teardown and the transcript so the three never disagree; this class owns only the I/O of reading
 * the log and appending the synthetic end.
 */
export class ServiceRecovery {
  private readonly log: EventLogPort
  private readonly ids: IdPort
  private readonly live: (() => readonly LiveService[] | undefined) | undefined
  private readonly inflight = new Map<ThreadId, Promise<readonly LostService[]>>()

  constructor(args: {
    log: EventLogPort
    ids: IdPort
    live?: (() => readonly LiveService[] | undefined) | undefined
  }) {
    this.log = args.log
    this.ids = args.ids
    this.live = args.live
  }

  recordLost(args: { threadId: ThreadId }): Promise<readonly LostService[]> {
    const { threadId } = args
    const running = this.inflight.get(threadId)
    if (running !== undefined) return running

    const attempt = this.reconcile({ threadId }).finally(() => {
      this.inflight.delete(threadId)
    })
    this.inflight.set(threadId, attempt)
    return attempt
  }

  private async reconcile(args: { threadId: ThreadId }): Promise<readonly LostService[]> {
    const { threadId } = args
    const events = await this.log.readOwn({ threadId })
    const lost = this.unresolvedBeforeThisBoot(lostServicesOf(events))
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

  private unresolvedBeforeThisBoot(
    lost: ReturnType<typeof lostServicesOf>,
  ): ReturnType<typeof lostServicesOf> {
    const beforeThisBoot = lost.filter((service) => service.started.bootId !== bootId)
    const live = this.live?.()
    if (live === undefined) return beforeThisBoot

    const liveIds = new Set(live.map((service) => service.serviceId))
    return beforeThisBoot.filter(
      (service) => service.started.bootId !== undefined || !liveIds.has(service.key),
    )
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

export const liveServicesOf = (
  snapshots: readonly ServiceSnapshot[],
): readonly LiveService[] =>
  snapshots
    .filter((snapshot) => snapshot.endedAt === undefined)
    .map((snapshot) => ({ serviceId: snapshot.serviceId }))
