import { Inject, Injectable } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import type { ESandboxStatus } from '@dltech/atlas-protocol'

@Injectable()
export class Agent37WebhookService {
  constructor(@Inject(ControlPlane) private readonly plane: ControlPlane) {}

  async applyStatus(args: {
    instanceId: string
    status: ESandboxStatus
    at: string
  }): Promise<boolean> {
    return this.plane.setSandboxStatus({
      sandboxInstanceId: args.instanceId,
      status: args.status,
      at: args.at,
    })
  }
}
