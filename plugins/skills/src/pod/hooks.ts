import type { RegisteredHook } from '@dltech/atlas-agent'
import { EStage, SKILL_LISTING_BUDGET_CHARS, type BeforeStep } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { catalogueOf } from './catalogue-source'
import { skillListingOf } from './listing'
import type { SkillsPodOptions } from './resources'

type Ctx = PluginPodContext

const ORDER = { stage: EStage.Observe, nudge: 0 }

export const skillsListingHook = (args: {
  ctx: Ctx
  options: SkillsPodOptions
}): RegisteredHook<BeforeStep> => ({
  name: 'skills-listing',
  order: ORDER,
  run: async ({ assembled }) => {
    const catalogue = await catalogueOf({ ctx: args.ctx, options: args.options })
    if (catalogue === null) return assembled
    const listing = skillListingOf({ catalogue, budgetChars: SKILL_LISTING_BUDGET_CHARS })
    if (listing === '') return assembled
    return {
      ...assembled,
      system: [...assembled.system, { text: listing, source: 'skills-listing' }],
    }
  },
})
