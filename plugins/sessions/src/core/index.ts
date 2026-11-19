import { PLAN_VIEW, planView, planViewSchema } from '@dltech/atlas-core'

export { PLAN_VIEW, planViewSchema }
export type { PlanTask, PlanViewState } from '@dltech/atlas-core'

export const sessionsCoreSlots = {
  events: [] as readonly never[],
  views: [planView],
  commands: [] as readonly never[],
} as const
