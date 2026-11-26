import { Inject, Injectable, Logger } from '@nestjs/common'
import { ControlPlane, type ControlSessionRow } from '@dltech/atlas-control'
import { INBOX_KIND_STOP } from '@dltech/atlas-core'
import type { SessionSleepPodOutput } from '@dltech/atlas-protocol'

import { JobsProjectDispatcher } from '../../../_core/ports/job-dispatcher'
import { readPodStopBusy } from '@dltech/atlas-pods'
import { PodTurnRunningError } from './pod-power.error'
import {
  podSleepIdempotencyKey,
  podSleepTaskContract,
} from '../../../_lib/trigger/pod-sleep.contract'

export type PodPower = {
  sleep(args: { session: ControlSessionRow; force: boolean }): Promise<SessionSleepPodOutput>
  parkArchived(args: { session: ControlSessionRow }): Promise<void>
}

/**
 * The operator's stop button. A pod that is working is only slept when the operator says so: the
 * turn is stopped through the inbox first, because sleeping mid-turn kills the daemon.
 */
@Injectable()
export class PodPowerService implements PodPower {
  private readonly logger = new Logger(PodPowerService.name)

  constructor(
    @Inject(ControlPlane) private readonly plane: ControlPlane,
    @Inject(JobsProjectDispatcher) private readonly dispatcher: JobsProjectDispatcher,
  ) {}

  async sleep(args: {
    session: ControlSessionRow
    force: boolean
  }): Promise<SessionSleepPodOutput> {
    const podSessionId = args.session.podSessionId ?? args.session.sessionId
    const busy = await readPodStopBusy({ plane: this.plane, session: args.session })
    if (busy.busy && !args.force) throw new PodTurnRunningError({ running: busy.running })
    if (busy.busy) {
      await this.plane.post({ sessionId: podSessionId, kind: INBOX_KIND_STOP, payload: '{}' })
    }
    const { parkedAt } = await this.plane.parkPod({ sessionId: podSessionId })
    await this.dispatchSleep({ podSessionId, parkedAt })
    return { state: 'sleeping' }
  }

  async parkArchived(args: { session: ControlSessionRow }): Promise<void> {
    const { session } = args
    if (!(await this.ownsItsPodAlone(session))) return
    try {
      await this.dispatchSleep({ podSessionId: session.sessionId })
    } catch (failure) {
      this.logger.warn(
        `parking the pod of archived session ${session.sessionId} failed: ${String(failure)}`,
      )
    }
  }

  private async dispatchSleep(args: {
    podSessionId: string
    parkedAt?: string | undefined
  }): Promise<void> {
    const { lease } = await this.plane.currentLease({ sessionId: args.podSessionId })
    const payload = {
      sessionId: args.podSessionId,
      epoch: lease.epoch,
      ...(args.parkedAt === undefined ? {} : { parkedAt: args.parkedAt }),
    }
    await this.dispatcher.dispatch({
      task: podSleepTaskContract,
      payload,
      idempotencyKey: podSleepIdempotencyKey(payload),
    })
  }

  private async ownsItsPodAlone(session: ControlSessionRow): Promise<boolean> {
    const podSessionId = session.podSessionId ?? session.sessionId
    if (podSessionId !== session.sessionId) return false
    const peers = await this.plane.podPeersPlaced({
      podSessionId,
      excludeSessionId: session.sessionId,
    })
    return peers === 0
  }
}
