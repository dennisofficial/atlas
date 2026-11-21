import { Inject, Injectable } from '@nestjs/common'
import { ControlPlane, type ControlSessionRow } from '@dltech/atlas-control'
import { INBOX_KIND_STOP, podBusyFactsOf, podBusyOf, type PodBusy } from '@dltech/atlas-core'
import { shellRosterOf } from '@dltech/atlas-plugin-shells/client'
import { servicesOfView } from '@dltech/atlas-plugin-services/client'
import type { SessionSleepPodOutput } from '@dltech/atlas-protocol'

import { JobDispatcher } from '../../../_core/ports/job-dispatcher'
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
    const busy = await this.busyOf({ session: args.session })
    if (busy.busy && !args.force) throw new PodTurnRunningError({ running: busy.running })
    if (busy.busy) {
      await this.plane.post({ sessionId: podSessionId, kind: INBOX_KIND_STOP, payload: '{}' })
    }
    // Releasing a lease the pod no longer holds still moves its epoch on, and the epoch keys the
    // job: the second press of stop has to land on the job the first one dispatched.
    const current = await this.plane.currentLease({ sessionId: podSessionId })
    const held = current.lease.holderHostId !== null || current.lease.wantsHolder
    if (held) await this.plane.revoke({ sessionId: podSessionId, wantsHolder: false })
    const { lease } = held ? await this.plane.currentLease({ sessionId: podSessionId }) : current
    const payload = { sessionId: podSessionId, epoch: lease.epoch }
    await this.dispatcher.dispatch({
      task: podSleepTaskContract,
      payload,
      idempotencyKey: podSleepIdempotencyKey(payload),
    })
    return { state: 'sleeping' }
  }

  private async busyOf(args: { session: ControlSessionRow }): Promise<PodBusy> {
    const busy = await this.plane.readSessionBusy({
      sessionId: args.session.sessionId,
      threadId: args.session.mainThreadId,
    })
    return podBusyOf(
      podBusyFactsOf({
        state: busy.status.state,
        shellsRunning: shellRosterOf(busy.pluginViews).running,
        servicesRunning: servicesOfView(busy.pluginViews).filter((row) => row.status === 'running')
          .length,
      }),
    )
  }
}
