import { BadRequestException } from '@nestjs/common'
import { EVercelPlan, VERCEL_PLAN_MAX_VCPUS, vercelPlanCapNote } from '@dltech/atlas-wire/web'
import type { PlanSnapshot } from './vercel-credential-plan'

export const PLAN_CAP_STALE_MS = 60 * 60_000

export function assertWithinPlanCap(args: {
  vcpus: number | null | undefined
  snapshot: PlanSnapshot | null
}): void {
  if (args.vcpus === null || args.vcpus === undefined) return
  const { snapshot } = args
  if (snapshot === null || snapshot.plan === EVercelPlan.Unknown) return
  if (args.vcpus <= VERCEL_PLAN_MAX_VCPUS[snapshot.plan]) return
  throw new BadRequestException(
    `${args.vcpus} vCPU exceeds ${vercelPlanCapNote(snapshot.plan)} on the connected Vercel team`,
  )
}
