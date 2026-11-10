import type { RegisteredHook } from '@dltech/atlas-agent'
import { EStage, type BeforeStep, type BeforeTurn } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { catalogueFor } from './catalogue-source'
import { listingBudgetChars, skillListingOf } from './listing'
import type { CloudSkillSource } from './port'
import type { SkillsPodState } from './state'

export type SkillsPodOptions = { cloud: CloudSkillSource; contextWindowTokens: number }

type Ctx = Pick<PluginPodContext, 'call' | 'log'>

const ORDER = { stage: EStage.Observe, nudge: 0 }

export const skillsCatalogueHook = (args: {
  ctx: Ctx
  state: SkillsPodState
  options: SkillsPodOptions
}): RegisteredHook<BeforeTurn> => ({
  name: 'skills-catalogue',
  order: ORDER,
  run: async ({ projectDirectory }) => {
    args.state.directory = projectDirectory
    await catalogueFor({
      ctx: args.ctx,
      state: args.state,
      cloud: args.options.cloud,
      directory: projectDirectory,
      refresh: true,
    })
    return {}
  },
})

export const skillsListingHook = (args: {
  ctx: Ctx
  state: SkillsPodState
  options: SkillsPodOptions
}): RegisteredHook<BeforeStep> => ({
  name: 'skills-listing',
  order: ORDER,
  run: async ({ assembled }) => {
    const directory = args.state.directory
    if (directory === null) return assembled
    const catalogue = await catalogueFor({
      ctx: args.ctx,
      state: args.state,
      cloud: args.options.cloud,
      directory,
    })
    if (catalogue === null) return assembled
    const listing = skillListingOf({
      catalogue,
      budgetChars: listingBudgetChars(args.options.contextWindowTokens),
    })
    if (listing === '') return assembled
    return { ...assembled, system: [...assembled.system, { text: listing }] }
  },
})
