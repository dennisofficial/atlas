import { EMPTY_POD, type PluginPodContext, type PodSlot } from '@dltech/atlas-plugin-sdk'

import {
  QUALITY_REVIEW_BUDGET_MS,
  qualityIgnoredHook,
  qualityReviewHook,
  type QualitySettings,
} from './hook'

export {
  QUALITY_REVIEW_BUDGET_MS,
  qualityIgnoredHook,
  qualityReviewHook,
  type QualitySettings,
} from './hook'

export type QualityPodOptions = {
  settings: (ctx: PluginPodContext) => Promise<QualitySettings>
  budgetMs?: number | undefined
  clock?: (() => number) | undefined
}

export const qualityPodOf = (options: QualityPodOptions): PodSlot => ({
  ...EMPTY_POD,
  hooks: (ctx) => ({
    afterTool: [
      qualityReviewHook({
        ctx,
        options: {
          settings: options.settings,
          budgetMs: options.budgetMs ?? QUALITY_REVIEW_BUDGET_MS,
          clock: options.clock ?? Date.now,
        },
      }),
    ],
    afterTurn: [qualityIgnoredHook({ ctx })],
  }),
})
