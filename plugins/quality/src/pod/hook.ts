import type { AfterToolHook, RegisteredHook } from '@dltech/atlas-agent'
import {
  ESettingId,
  EStage,
  EToolEffect,
  type AfterTurn,
  type Event,
  type V2Event,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { CodeQualityReview } from '../review/engine'
import { qualityRegistry } from '../review/registry'
import { prepareQualityScopes } from '../review/source'
import {
  QUALITY_FINDING_IGNORED,
  QUALITY_FINDING_RESOLVED,
  QUALITY_REVIEW_COMPLETED,
  resolvedFindingProperties,
  reviewCompletedProperties,
} from './analytics/review-properties'
import { ignoredFindingProperties } from './analytics/ignored-properties'
import { reviewWithinBudget } from './review-outcome'

export const QUALITY_REVIEW_BUDGET_MS = 1000

export type QualitySettings = {
  enabled: boolean
  policies: Readonly<Record<string, boolean>>
}

export type QualityReviewOptions = {
  settings: (ctx: PluginPodContext) => Promise<QualitySettings>
  budgetMs: number
  clock: () => number
}

const coreEventsOf = (events: readonly V2Event[]): readonly Event[] =>
  events.flatMap((event): readonly Event[] => {
    if (event.type === 'code-quality-reviewed') return [event]
    if (event.type === 'tool-result') return [event]
    return []
  })

export const qualityReviewHook = (args: {
  ctx: PluginPodContext
  options: QualityReviewOptions
}): AfterToolHook => ({
  name: 'quality-review',
  order: { stage: EStage.Observe, nudge: 20 },
  capturesFileChanges: async ({ call }) => {
    if (call.effect !== EToolEffect.Write) return false
    if (!args.ctx.classifier.status().on) return false
    return (await args.options.settings(args.ctx)).enabled
  },
  run: async ({ call, result, projectDirectory, signal }) => {
    const status = args.ctx.classifier.status()
    if (!status.on || !result.ok) return {}
    const changes = result.fileChanges ?? []
    const captureFaults = result.fileChangeFaults ?? []
    if (changes.length === 0 && captureFaults.length === 0) return {}

    const settings = await args.options.settings(args.ctx)
    if (!settings.enabled) return {}

    const review = new CodeQualityReview({
      classifier: args.ctx.classifier,
      requestedModel: status.model,
      source: { prepareQualityScopes },
      registry: qualityRegistry,
      settings: () => ({ ...settings.policies, [ESettingId.QualityEnabled]: settings.enabled }),
      clock: args.options.clock,
      deadlineMs: args.options.budgetMs,
    })

    const events = args.ctx.events()
    const outcome = await reviewWithinBudget({
      review,
      clock: args.options.clock,
      log: (message) => args.ctx.log(message),
      call,
      result,
      events: coreEventsOf(events),
      projectDirectory,
      signal,
      budgetMs: args.options.budgetMs,
    })

    args.ctx.analytics.capture({
      event: QUALITY_REVIEW_COMPLETED,
      properties: reviewCompletedProperties({
        records: outcome.records,
        metrics: outcome,
        files: changes.length,
        notified: outcome.context !== undefined,
        classifier: { model: status.model, provider: status.provider },
        events,
      }),
    })
    for (const properties of resolvedFindingProperties({
      records: outcome.records,
      events,
      threadId: call.threadId,
    })) {
      args.ctx.analytics.capture({ event: QUALITY_FINDING_RESOLVED, properties })
    }

    return {
      drafts: outcome.records,
      ...(outcome.context === undefined
        ? {}
        : { additionalContext: outcome.context, contextKey: call.callId }),
    }
  },
})

export const qualityIgnoredHook = (args: { ctx: PluginPodContext }): RegisteredHook<AfterTurn> => ({
  name: 'quality-finding-ignored',
  order: { stage: EStage.Observe, nudge: 20 },
  run: async ({ threadId }) => {
    const events = args.ctx.events()
    for (const properties of ignoredFindingProperties({ events, threadId })) {
      args.ctx.analytics.capture({ event: QUALITY_FINDING_IGNORED, properties })
    }
    return {}
  },
})
