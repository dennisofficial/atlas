import { Global, Module } from '@nestjs/common'

import { PodPlanGate } from '../../../_core/ports/pod-plan-gate'
import { UserVercelModule } from './user-vercel.module'
import { VercelPodPlanGate } from './pod-plan-gate.service'

@Global()
@Module({
  imports: [UserVercelModule],
  providers: [{ provide: PodPlanGate, useClass: VercelPodPlanGate }],
  exports: [PodPlanGate],
})
export class PodPlanGateModule {}
