import { EStage, type BeforeStep } from '@dltech/atlas-core'
import type { RegisteredHook } from '@dltech/atlas-agent'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { withRunningRoster } from './roster-message'

export const runningRosterHook = (ctx: PluginPodContext): RegisteredHook<BeforeStep> => ({
  name: 'shells-running-roster',
  order: { stage: EStage.Observe, nudge: 0 },
  run: async ({ assembled }) => withRunningRoster({ assembled, events: ctx.events() }),
})
