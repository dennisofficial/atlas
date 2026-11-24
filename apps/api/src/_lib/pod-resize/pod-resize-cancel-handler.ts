import { BadRequestException } from '@nestjs/common'
import type { ControlCommandHandler } from '@dltech/atlas-commands'
import type { ControlPlane } from '@dltech/atlas-control'

import { podSessionIdOf, sessionOf } from './pod-resize-session'

export const podResizeCancelHandlerOf = (args: {
  plane: ControlPlane
}): ControlCommandHandler<ControlPlane, unknown> => {
  return async ({ sessionId }) => {
    const session = await sessionOf({ plane: args.plane, sessionId })
    const cancelled = await args.plane.cancelPodWait({ sessionId: podSessionIdOf(session) })
    if (!cancelled) throw new BadRequestException('No resize is waiting for the pod to go idle')
  }
}
