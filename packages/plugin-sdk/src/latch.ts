import { firedLatchLevelOf, latchFactOf, latchStepOf } from '@dltech/atlas-core'

import type { PluginPodContext } from './slots'

export const crossLatch = async (args: {
  ctx: Pick<PluginPodContext, 'append' | 'events'>
  name: string
  level: number
  mayFire: boolean
}): Promise<boolean> => {
  const fired = firedLatchLevelOf({ events: args.ctx.events(), name: args.name })
  const step = latchStepOf({ fired, level: args.level, mayFire: args.mayFire })
  if (step.record !== undefined) {
    await args.ctx.append([latchFactOf({ name: args.name, level: step.record })])
  }
  return step.fire
}
