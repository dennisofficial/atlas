import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common'
import type { ControlCommandHandler } from '@dltech/atlas-commands'
import { ControlPlane, type ControlSessionRow } from '@dltech/atlas-control'
import { resizeArgs } from '@dltech/atlas-native-commands'

import { SANDBOX_RESIZER, type SandboxResizer } from '../../../agent'
import { PodPlanGate } from '../../../_core/ports/pod-plan-gate'

export type PodSizing = {
  resizeHandler(args: {
    userId: string
    session: ControlSessionRow
  }): ControlCommandHandler<ControlPlane, unknown>
}

const failureText = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

@Injectable()
export class PodSizingService implements PodSizing {
  constructor(
    @Inject(ControlPlane) private readonly plane: ControlPlane,
    private readonly planGate: PodPlanGate,
    @Optional() @Inject(SANDBOX_RESIZER) private readonly resizer: SandboxResizer | null = null,
  ) {}

  resizeHandler(args: {
    userId: string
    session: ControlSessionRow
  }): ControlCommandHandler<ControlPlane, unknown> {
    return async ({ args: raw }) => {
      const { vcpus } = resizeArgs.parse(raw)
      await this.planGate.assertWithinPlan({ userId: args.userId, vcpus })
      const sessionId = args.session.podSessionId ?? args.session.sessionId
      const generation = await this.plane.recordPodDesired({ sessionId, vcpus })
      if (this.resizer === null) {
        throw new ServiceUnavailableException('the agent host is not running')
      }
      try {
        const resized = await this.resizer.resize({ sandboxSessionId: sessionId, vcpus })
        if (resized === 'restarted') {
          await this.plane.revoke({ sessionId, wantsHolder: true })
        }
      } catch (error) {
        await this.plane.recordPodFailed({ sessionId, generation, error: failureText(error) })
        throw error
      }
    }
  }
}
