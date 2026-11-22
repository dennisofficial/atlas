import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import type { ControlCommandHandler } from '@dltech/atlas-commands'
import { ControlPlane, type ControlSessionRow } from '@dltech/atlas-control'
import { resizeArgs } from '@dltech/atlas-native-commands'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import { JobsProjectDispatcher } from '../../../_core/ports/job-dispatcher'
import { podResizeIdempotencyKey, podResizeTaskContract } from './pod-resize.contract'
import { assertWithinShapeLimit, podSizingLimitOf } from './pod-vcpu-limit'

const assertDiskAllowed = (args: { diskGb: number | undefined; sandboxProvider: string }): void => {
  if (args.diskGb === undefined || args.sandboxProvider === ESandboxProvider.Agent37) return
  throw new BadRequestException('Only an Agent37 pod has a disk that the operator can grow')
}

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
    @Inject(JobsProjectDispatcher) private readonly dispatcher: JobsProjectDispatcher,
  ) {}

  resizeHandler(args: {
    userId: string
    session: ControlSessionRow
  }): ControlCommandHandler<ControlPlane, unknown> {
    return async ({ args: raw }) => {
      const { vcpus, memoryGb, diskGb, whenIdle } = resizeArgs.parse(raw)
      assertWithinShapeLimit({
        shape: { vcpus, memoryGb },
        sizing: podSizingLimitOf({ sandboxProvider: args.session.sandboxProvider }),
      })
      assertDiskAllowed({ diskGb, sandboxProvider: args.session.sandboxProvider })
      const sessionId = args.session.podSessionId ?? args.session.sessionId
      const generation = await this.plane.recordPodDesired({
        sessionId,
        vcpus,
        memoryGb,
        ...(diskGb === undefined ? {} : { diskGb }),
      })
      const payload = {
        sessionId,
        generation,
        vcpus,
        memoryGb,
        ...(diskGb === undefined ? {} : { diskGb }),
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
