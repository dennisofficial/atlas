import { Inject, Injectable } from '@nestjs/common'
import { ControlPlane, type ControlSessionRow } from '@dltech/atlas-control'
import { INBOX_KIND_STOP } from '@dltech/atlas-core'
import type { SessionSleepPodOutput } from '@dltech/atlas-protocol'

import { JobDispatcher } from '../../../_core/ports/job-dispatcher'
import { readPodBusy } from './pod-busy'
import { PodTurnRunningError } from './pod-power.error'
import { podSleepIdempotencyKey, podSleepTaskContract } from './pod-sleep.contract'

export type PodPower = {
  sleep(args: { session: ControlSessionRow; force: boolean }): Promise<SessionSleepPodOutput>
}

/**
 * The operator's stop button. A pod that is working is only slept when the operator says so: the
 * turn is stopped through the inbox first, because sleeping mid-turn kills the daemon.
 */
@Injectable()
export class PodPowerService implements PodPower {
  constructor(
    @Inject(ControlPlane) private readonly plane: ControlPlane,
    @Inject(JobDispatcher) private readonly dispatcher: JobDispatcher,
  ) {}

  async sleep(args: {
    session: ControlSessionRow
    force: boolean
  }): Promise<SessionSleepPodOutput> {
    const podSessionId = args.session.podSessionId ?? args.session.sessionId
    const busy = await readPodBusy({ plane: this.plane, session: args.session })
    if (busy.busy && !args.force) throw new PodTurnRunningError({ running: busy.running })
    if (busy.busy) {
      await this.plane.post({ sessionId: podSessionId, kind: INBOX_KIND_STOP, payload: '{}' })
    }
    // The stop stays unread until the turn ends, and demand is what the claim loop reads: releasing
    // here would let another host claim the session and wake the pod this sleep is about to stop.
    // The job keeps the lease until the turn ends, then releases it and sleeps the pod.
    const { lease } = await this.plane.currentLease({ sessionId: podSessionId })
    const payload = { sessionId: podSessionId, epoch: lease.epoch }
    await this.dispatcher.dispatch({
      task: podSleepTaskContract,
      payload,
      idempotencyKey: podSleepIdempotencyKey(payload),
    })
    return { state: 'sleeping' }
  }
}
