import { Inject, Injectable } from '@nestjs/common'
import type { ControlCommandHandler } from '@dltech/atlas-commands'
import { ControlPlane, type ControlSessionRow } from '@dltech/atlas-control'
import { resizeArgs } from '@dltech/atlas-native-commands'

import { JobDispatcher } from '../../../_core/ports/job-dispatcher'
import { PodPlanGate } from '../../../_core/ports/pod-plan-gate'
import { podResizeIdempotencyKey, podResizeTaskContract } from './pod-resize.contract'
import { assertWithinVcpuLimit, vcpuLimitOf } from './pod-vcpu-limit'

export type PodSizing = {
  resizeHandler(args: {
    userId: string
    session: ControlSessionRow
  }): ControlCommandHandler<ControlPlane, unknown>
}

@Injectable()
export class PodSizingService implements PodSizing {
  constructor(
    @Inject(ControlPlane) private readonly plane: ControlPlane,
    @Inject(JobDispatcher) private readonly dispatcher: JobDispatcher,
    private readonly planGate: PodPlanGate,
  ) {}

  resizeHandler(args: {
    userId: string
    session: ControlSessionRow
  }): ControlCommandHandler<ControlPlane, unknown> {
    return async ({ args: raw }) => {
      const { vcpus, whenIdle } = resizeArgs.parse(raw)
      const limit = vcpuLimitOf(args.session)
      if (limit === null) await this.planGate.assertWithinPlan({ userId: args.userId, vcpus })
      else assertWithinVcpuLimit({ vcpus, limit })
      const sessionId = args.session.podSessionId ?? args.session.sessionId
      const generation = await this.plane.recordPodDesired({ sessionId, vcpus })
      const payload = {
        sessionId,
        generation,
        vcpus,
        ...(whenIdle === undefined ? {} : { whenIdle }),
      }
      await this.dispatcher.dispatch({
        task: podResizeTaskContract,
        payload,
        idempotencyKey: podResizeIdempotencyKey(payload),
      })
    }
  }
}
