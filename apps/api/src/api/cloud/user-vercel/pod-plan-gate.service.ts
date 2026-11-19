import { Injectable } from '@nestjs/common'

import { PodPlanGate } from '../../../_core/ports/pod-plan-gate'
import { assertWithinPlanCap, PLAN_CAP_STALE_MS } from './plan-cap'
import { VercelPlanService } from './vercel-credential-plan'

@Injectable()
export class VercelPodPlanGate extends PodPlanGate {
  constructor(private readonly plans: VercelPlanService) {
    super()
  }

  async assertWithinPlan(args: { userId: string; vcpus: number }): Promise<void> {
    assertWithinPlanCap({
      vcpus: args.vcpus,
      snapshot: await this.plans.storedPlan({
        userId: args.userId,
        staleAfterMs: PLAN_CAP_STALE_MS,
      }),
    })
  }
}
