import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { ControlCommandHandler } from '@dltech/atlas-commands'
import type { ControlPlane, ControlSessionRow } from '@dltech/atlas-control'
import { resizeArgs } from '@dltech/atlas-native-commands'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import type { JobsProjectDispatcher } from '../../_core/ports/job-dispatcher'
import { podResizeIdempotencyKey, podResizeTaskContract } from './pod-resize.contract'
import { assertWithinShapeLimit, podSizingLimitOf } from './pod-vcpu-limit'

const assertDiskAllowed = (args: { diskGb: number | undefined; sandboxProvider: string }): void => {
  if (args.diskGb === undefined || args.sandboxProvider === ESandboxProvider.Agent37) return
  throw new BadRequestException('Only an Agent37 pod has a disk that the operator can grow')
}

const sessionOf = async (args: {
  plane: ControlPlane
  sessionId: string
}): Promise<ControlSessionRow> => {
  const session = await args.plane.readSession({ sessionId: args.sessionId })
  if (session === undefined || session.deletedAt !== null) {
    throw new NotFoundException('session not found')
  }
  return session
}

export const podResizeHandlerOf = (args: {
  plane: ControlPlane
  dispatcher: JobsProjectDispatcher
}): ControlCommandHandler<ControlPlane, unknown> => {
  return async ({ sessionId, args: raw }) => {
    const session = await sessionOf({ plane: args.plane, sessionId })
    const { vcpus, memoryGb, diskGb, whenIdle } = resizeArgs.parse(raw)
    assertWithinShapeLimit({
      shape: { vcpus, memoryGb },
      sizing: podSizingLimitOf({ sandboxProvider: session.sandboxProvider }),
    })
    assertDiskAllowed({ diskGb, sandboxProvider: session.sandboxProvider })
    const podSessionId = session.podSessionId ?? session.sessionId
    const generation = await args.plane.recordPodDesired({
      sessionId: podSessionId,
      vcpus,
      memoryGb,
      ...(diskGb === undefined ? {} : { diskGb }),
    })
    const payload = {
      sessionId: podSessionId,
      generation,
      vcpus,
      memoryGb,
      ...(diskGb === undefined ? {} : { diskGb }),
      ...(whenIdle === undefined ? {} : { whenIdle }),
    }
    await args.dispatcher.dispatch({
      task: podResizeTaskContract,
      payload,
      idempotencyKey: podResizeIdempotencyKey(payload),
    })
  }
}
