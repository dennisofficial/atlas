import { Inject, Injectable } from '@nestjs/common'
import type { ControlCommandHandler } from '@dltech/atlas-commands'
import { ControlPlane, type ControlSessionRow } from '@dltech/atlas-control'
import { resizeArgs } from '@dltech/atlas-native-commands'

import { JobDispatcher } from '../../../_core/ports/job-dispatcher'
import { podResizeIdempotencyKey, podResizeTaskContract } from './pod-resize.contract'
import { assertWithinShapeLimit, podSizingLimitOf } from './pod-vcpu-limit'

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
  ) {}

  resizeHandler(args: {
    userId: string
    session: ControlSessionRow
  }): ControlCommandHandler<ControlPlane, unknown> {
    return async ({ args: raw }) => {
      const { vcpus, memoryGb, whenIdle } = resizeArgs.parse(raw)
      assertWithinShapeLimit({
        shape: { vcpus, memoryGb },
        sizing: podSizingLimitOf({ sandboxProvider: args.session.sandboxProvider }),
      })
      const sessionId = args.session.podSessionId ?? args.session.sessionId
      const generation = await this.plane.recordPodDesired({ sessionId, vcpus, memoryGb })
      const payload = {
        sessionId,
        generation,
        vcpus,
        memoryGb,
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
