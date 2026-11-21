import { Inject, Injectable } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import { ESandboxStatus } from '@dltech/atlas-protocol'
import { recordSandboxRunCloseForInstance } from '../../../agent'

@Injectable()
export class Agent37WebhookService {
  constructor(@Inject(ControlPlane) private readonly plane: ControlPlane) {}

  async applyStatus(args: {
    instanceId: string
    status: ESandboxStatus
    reason?: string | undefined
    at: string
  }): Promise<boolean> {
    const applied = await this.plane.setSandboxStatus({
      sandboxInstanceId: args.instanceId,
      status: args.status,
      ...(args.reason === undefined ? {} : { reason: args.reason }),
      at: args.at,
    })
    if (
      applied &&
      (args.status === ESandboxStatus.Sleeping || args.status === ESandboxStatus.Stopped)
    )
      await recordSandboxRunCloseForInstance({
        sandboxInstanceId: args.instanceId,
        at: Date.parse(args.at),
      })
    return applied
  }
}
